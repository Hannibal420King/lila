package lila.web

import java.nio.charset.StandardCharsets
import java.security.{ KeyPair, KeyPairGenerator, Signature }
import java.security.interfaces.EdECPublicKey
import java.time.Instant
import java.util.Base64

import play.api.libs.json.*

class VortexIdentityTest extends munit.FunSuite:

  private val now = Instant.parse("2026-07-18T12:00:00Z")
  private val pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
  private val audience = "vortex-app:00000000-0000-4000-8000-000000000001"
  private val issuer = "https://vortex.example.com"
  private val verifier = VortexIdentity.Verifier(jwks(pair), audience, issuer, now = () => now)

  test("verify an audience-bound Ed25519 identity assertion"):
    val identity = verifier.verify(assertion(pair))

    assertEquals(identity.playerId, "00000000-0000-4000-8000-000000000002")
    assertEquals(identity.playSessionId, "00000000-0000-4000-8000-000000000003")
    assertEquals(identity.handle, "player-one")
    assertEquals(identity.displayName, "Player One")
    assertEquals(identity.scopes, List("identity.basic", "play.write"))

  test("reject wrong issuer, audience, expiry, and changed signatures"):
    intercept[VortexIdentity.InvalidAssertion]:
      verifier.verify(assertion(pair, iss = "https://wrong.example.com"))
    intercept[VortexIdentity.InvalidAssertion]:
      verifier.verify(assertion(pair, aud = "vortex-app:wrong"))
    intercept[VortexIdentity.InvalidAssertion]:
      verifier.verify(assertion(pair, expiresAt = now.getEpochSecond - 60))

    val valid = assertion(pair)
    val changed = valid.updated(valid.length - 2, if valid(valid.length - 2) == 'a' then 'b' else 'a')
    intercept[VortexIdentity.InvalidAssertion]:
      verifier.verify(changed)

  private def assertion(
      keyPair: KeyPair,
      aud: String = audience,
      iss: String = issuer,
      expiresAt: Long = now.getEpochSecond + 60
  ): String =
    val header = Json.obj("alg" -> "EdDSA", "typ" -> "JWT", "kid" -> "test-key")
    val payload = Json.obj(
      "iss" -> iss,
      "aud" -> aud,
      "sub" -> "00000000-0000-4000-8000-000000000002",
      "sid" -> "00000000-0000-4000-8000-000000000003",
      "handle" -> "player-one",
      "name" -> "Player One",
      "picture" -> JsNull,
      "scp" -> Json.arr("identity.basic", "play.write"),
      "iat" -> now.getEpochSecond,
      "exp" -> expiresAt,
      "jti" -> "00000000-0000-4000-8000-000000000004"
    )
    val encodedHeader = encode(Json.stringify(header).getBytes(StandardCharsets.UTF_8))
    val encodedPayload = encode(Json.stringify(payload).getBytes(StandardCharsets.UTF_8))
    val input = s"$encodedHeader.$encodedPayload"
    val signer = Signature.getInstance("Ed25519")
    signer.initSign(keyPair.getPrivate)
    signer.update(input.getBytes(StandardCharsets.US_ASCII))
    s"$input.${encode(signer.sign())}"

  private def jwks(keyPair: KeyPair): String =
    val point = keyPair.getPublic.asInstanceOf[EdECPublicKey].getPoint
    val yBigEndian = point.getY.toByteArray.dropWhile(_ == 0)
    val y = Array.fill[Byte](32)(0)
    Array.copy(yBigEndian, 0, y, 32 - yBigEndian.length, yBigEndian.length)
    val raw = y.reverse
    if point.isXOdd then raw(31) = (raw(31) | 0x80).toByte
    Json.stringify:
      Json.obj(
        "keys" -> Json.arr(
          Json.obj(
            "kty" -> "OKP",
            "crv" -> "Ed25519",
            "x" -> encode(raw),
            "kid" -> "test-key",
            "alg" -> "EdDSA",
            "use" -> "sig"
          )
        )
      )

  private def encode(value: Array[Byte]) = Base64.getUrlEncoder.withoutPadding.encodeToString(value)
