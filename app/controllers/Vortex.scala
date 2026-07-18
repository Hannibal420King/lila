package controllers

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

import scala.util.Try

import play.api.libs.json.Json
import play.api.mvc.*

import lila.app.*
import lila.core.config.CollName
import lila.core.email.EmailAddress
import lila.core.security.ClearPassword
import lila.core.userId.UserName
import lila.db.dsl.{ *, given }
import lila.security.IsPwned
import lila.web.VortexIdentity as VerifiedIdentity

final class Vortex(env: Env) extends LilaController(env):

  private val identityColl = env.mongo.mainDb(CollName("vortex_identity"))

  def config = Action:
    val publicUrl = sys.env.get("VORTEX_PUBLIC_URL").map(_.stripSuffix("/")).filter(_.nonEmpty)
    val sdkUrl = sys.env.get("VORTEX_SDK_URL").filter(_.nonEmpty)
    val result = (publicUrl, sdkUrl) match
      case (None, None) => Ok(Json.obj("enabled" -> false))
      case (Some(origin), Some(sdk)) =>
        Ok(Json.obj("enabled" -> true, "vortexOrigin" -> origin, "sdkUrl" -> sdk))
      case _ =>
        ServiceUnavailable(Json.obj("enabled" -> false, "error" -> "Vortex configuration is incomplete"))
    result.withHeaders(CACHE_CONTROL -> "no-store")

  def session = Action.async(parse.empty): request =>
    given RequestHeader = request
    identityFrom(request)
      .flatMap: identity =>
        if !identity.scopes.contains("identity.basic") then
          fufail(VerifiedIdentity.InvalidAssertion())
        else mappedUser(identity).flatMap(authenticate(_, identity))
      .recover:
        case _: VerifiedIdentity.InvalidAssertion =>
          Unauthorized(Json.obj("authenticated" -> false, "error" -> "Vortex identity is invalid"))
        case error =>
          lila.log("vortex").error("Vortex account mapping failed", error)
          ServiceUnavailable(Json.obj("authenticated" -> false, "error" -> "Account mapping is unavailable"))

  def health = Action.async:
    identityColl
      .exists($empty)
      .map: _ =>
        Ok(Json.obj("status" -> "healthy", "database" -> "healthy"))
      .recover: _ =>
        ServiceUnavailable(Json.obj("status" -> "unhealthy", "database" -> "unhealthy"))

  private lazy val assertionVerifier = VerifiedIdentity.Verifier(
    requiredEnvironment("VORTEX_IDENTITY_JWKS"),
    requiredEnvironment("VORTEX_IDENTITY_AUDIENCE"),
    requiredEnvironment("VORTEX_IDENTITY_ISSUER")
  )

  private def identityFrom(request: RequestHeader): Fu[VerifiedIdentity] =
    if environmentFlag("VORTEX_DEV_IDENTITY") then
      Try(devIdentity).fold(fufail, fuccess)
    else
      request.headers
        .get("X-Vortex-Identity")
        .fold(fufail[VerifiedIdentity](VerifiedIdentity.InvalidAssertion())): assertion =>
          Try(assertionVerifier.verify(assertion)).fold(fufail, fuccess)

  private def devIdentity = VerifiedIdentity(
    playerId = requiredEnvironment("VORTEX_DEV_PLAYER_ID"),
    playSessionId = "00000000-0000-4000-8000-000000000011",
    handle = sys.env.getOrElse("VORTEX_DEV_HANDLE", "vortex-player"),
    displayName = sys.env.getOrElse("VORTEX_DEV_DISPLAY_NAME", "Vortex Player"),
    avatarUrl = none,
    scopes = List("identity.basic", "play.write", "events.write"),
    manifestRevisionId = none,
    issuedAt = nowInstant.getEpochSecond,
    expiresAt = nowInstant.plusSeconds(3600).getEpochSecond,
    tokenId = "00000000-0000-4000-8000-000000000012"
  )

  private def mappedUser(identity: VerifiedIdentity): Fu[lila.core.user.User] =
    val username = mappedUsername(identity)
    val userId = username.id
    val reservation = $doc(
      "$setOnInsert" -> $doc(
        "_id" -> identity.playerId,
        "user" -> userId,
        "createdAt" -> nowInstant
      )
    )
    for
      _ <- identityColl.update.one($id(identity.playerId), reservation, upsert = true)
      mappedId <- identityColl
        .primitiveOne[UserId]($id(identity.playerId), "user")
        .orFail("Vortex identity mapping could not be reserved")
      user <- env.user.repo.byId(mappedId).flatMap:
        case Some(user) => fuccess(user)
        case None if mappedId == userId =>
          val password = ClearPassword(scalalib.SecureRandom.nextString(64))
          val email = EmailAddress(s"vortex.${identityDigest(identity.playerId).take(32)}@accounts.invalid")
          env.user.repo
            .create(
              username,
              env.security.authenticator.passEnc(password),
              email,
              blind = false,
              mustConfirmEmail = false
            )
            .flatMap:
              case Some(user) => fuccess(user)
              case None => env.user.repo.byId(mappedId).orFail("Mapped Lila account could not be created")
        case None => fufail("Mapped Lila account is missing")
    yield user

  private def authenticate(user: lila.core.user.User, identity: VerifiedIdentity)(using
      request: RequestHeader
  ): Fu[Result] =
    def response(cookie: Option[Cookie]) =
      val result = Ok(
        Json.obj(
          "authenticated" -> true,
          "username" -> user.username.value,
          "displayName" -> identity.displayName
        )
      ).withHeaders(CACHE_CONTROL -> "no-store")
      cookie.fold(result)(result.withCookies(_))

    env.security.api.reqSessionId(request) match
      case Some(sessionId) =>
        env.security.store.authInfo(sessionId).flatMap:
          case Some(info) if info.user == user.id => fuccess(response(none))
          case _ => newSession(user).map(cookie => response(cookie.some))
      case None => newSession(user).map(cookie => response(cookie.some))

  private def newSession(user: lila.core.user.User)(using RequestHeader): Fu[Cookie] =
    env.security.api
      .saveAuthentication(user.id, apiVersion = none, pwned = IsPwned.No)
      .map: sessionId =>
        env.security.lilaCookie.withSession(remember = true): session =>
          session + (env.security.api.sessionIdKey -> sessionId.value)

  private def mappedUsername(identity: VerifiedIdentity): UserName =
    val handle = identity.handle
      .filter(char => char.isLetterOrDigit && char.toInt < 128)
      .take(8)
      .match
      case "" => "player"
      case value => value
    UserName(s"V_${handle}_${identityDigest(identity.playerId).take(16)}")

  private def identityDigest(value: String) =
    MessageDigest
      .getInstance("SHA-256")
      .digest(value.getBytes(StandardCharsets.UTF_8))
      .map("%02x".format(_))
      .mkString

  private def environmentFlag(name: String) =
    sys.env.get(name).exists(value => Set("1", "true", "yes", "on").contains(value.toLowerCase))

  private def requiredEnvironment(name: String) =
    sys.env.get(name).filter(_.nonEmpty).getOrElse(throw IllegalStateException(s"$name is required"))
