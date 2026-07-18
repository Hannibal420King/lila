package lila.web

import java.math.BigInteger
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.{ KeyFactory, Signature }
import java.security.spec.{ EdECPoint, EdECPublicKeySpec, NamedParameterSpec }
import java.time.Instant
import java.util.Base64

import scala.util.Try

import play.api.libs.json.*

final case class VortexIdentity(
    playerId: String,
    playSessionId: String,
    handle: String,
    displayName: String,
    avatarUrl: Option[String],
    scopes: List[String],
    manifestRevisionId: Option[String],
    issuedAt: Long,
    expiresAt: Long,
    tokenId: String
)

object VortexIdentity:

  final class InvalidAssertion()
      extends RuntimeException("Vortex identity assertion is invalid")

  final class Verifier(
      jwksJson: String,
      audience: String,
      issuer: String,
      clockToleranceSeconds: Long = 5,
      now: () => Instant = () => Instant.now()
  ):
    private val expectedAudience =
      require(audience.startsWith("vortex-app:"), "Vortex identity audience is invalid")
      audience
    private val expectedIssuer = canonicalOrigin(issuer)
    private val keys = parseKeys(jwksJson)

    def verify(assertion: String): VortexIdentity = invalidOnFailure:
      require(assertion.length >= 32 && assertion.length <= 16_384)
      val parts = assertion.split("\\.", -1)
      require(parts.length == 3)

      val header = decodeJson(parts(0))
      require(claimString(header, "alg", 16) == "EdDSA")
      require(claimString(header, "typ", 16) == "JWT")
      val key = keys.getOrElse(claimString(header, "kid", 200), throw InvalidAssertion())

      val signature = Base64.getUrlDecoder.decode(parts(2))
      require(signature.length == 64)
      val verifier = Signature.getInstance("Ed25519")
      verifier.initVerify(key)
      verifier.update(s"${parts(0)}.${parts(1)}".getBytes(StandardCharsets.US_ASCII))
      require(verifier.verify(signature))

      val payload = decodeJson(parts(1))
      require(claimString(payload, "iss", 2_048) == expectedIssuer)
      require(audiences(payload).contains(expectedAudience))

      val issuedAt = claimLong(payload, "iat")
      val expiresAt = claimLong(payload, "exp")
      val epochSeconds = now().getEpochSecond
      require(issuedAt <= epochSeconds + clockToleranceSeconds)
      require(expiresAt >= epochSeconds - clockToleranceSeconds)
      require(expiresAt > issuedAt)

      VortexIdentity(
        playerId = claimString(payload, "sub", 200),
        playSessionId = claimString(payload, "sid", 200),
        handle = claimString(payload, "handle", 32),
        displayName = claimString(payload, "name", 80),
        avatarUrl = optionalString(payload, "picture", 2_048),
        scopes = stringList(payload, "scp", 18, 80),
        manifestRevisionId = optionalString(payload, "manifest_revision", 200),
        issuedAt = issuedAt,
        expiresAt = expiresAt,
        tokenId = claimString(payload, "jti", 200)
      )

  private def parseKeys(jwksJson: String) = invalidOnFailure:
    val keys = (Json.parse(jwksJson) \ "keys").as[List[JsObject]]
    require(keys.nonEmpty && keys.size <= 4)
    keys.map: key =>
      require(claimString(key, "kty", 16) == "OKP")
      require(claimString(key, "crv", 16) == "Ed25519")
      require(optionalString(key, "alg", 16).forall(_ == "EdDSA"))
      require(optionalString(key, "use", 16).forall(_ == "sig"))
      val raw = Base64.getUrlDecoder.decode(claimString(key, "x", 200))
      require(raw.length == 32)
      val yBytes = raw.clone()
      val xOdd = (yBytes(31) & 0x80) != 0
      yBytes(31) = (yBytes(31) & 0x7f).toByte
      val point = EdECPoint(xOdd, BigInteger(1, yBytes.reverse))
      val publicKey = KeyFactory
        .getInstance("Ed25519")
        .generatePublic(EdECPublicKeySpec(NamedParameterSpec.ED25519, point))
      claimString(key, "kid", 200) -> publicKey
    .toMap

  private def decodeJson(value: String): JsObject =
    Json.parse(Base64.getUrlDecoder.decode(value)).as[JsObject]

  private def claimString(value: JsObject, key: String, maxLength: Int): String =
    val claim = (value \ key).as[String]
    require(claim.nonEmpty && claim.length <= maxLength)
    claim

  private def optionalString(value: JsObject, key: String, maxLength: Int): Option[String] =
    (value \ key).toOption.filterNot(_ == JsNull).map: _ =>
      claimString(value, key, maxLength)

  private def claimLong(value: JsObject, key: String): Long =
    (value \ key).as[Long]

  private def stringList(value: JsObject, key: String, maxItems: Int, maxLength: Int): List[String] =
    (value \ key).toOption.fold(List.empty[String]): node =>
      val values = node.as[List[String]]
      require(values.size <= maxItems)
      values.map: value =>
        require(value.nonEmpty && value.length <= maxLength)
        value

  private def audiences(payload: JsObject): List[String] =
    (payload \ "aud").toOption.fold(List.empty[String]): value =>
      value.validate[String].asOpt.fold(value.as[List[String]])(List(_))

  private def canonicalOrigin(value: String): String = invalidOnFailure:
    val uri = URI(value)
    require(uri.getScheme == "https" || uri.getScheme == "http")
    require(uri.getHost != null && uri.getUserInfo == null)
    URI(uri.getScheme, null, uri.getHost, uri.getPort, null, null, null).toString

  private def invalidOnFailure[A](run: => A): A =
    Try(run).recover { case _: Throwable => throw InvalidAssertion() }.get
