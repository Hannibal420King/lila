package lila.web

import java.net.URI

import scala.util.Try

object VortexPublicOrigin:

  val EnvironmentName = "VORTEX_PUBLIC_URL"

  def configured(): Either[String, Option[String]] = configured(sys.env)

  def configured(environment: collection.Map[String, String]): Either[String, Option[String]] =
    environment.get(EnvironmentName) match
      case None => Right(none)
      case Some(value) if value.isEmpty => Right(none)
      case Some(value) => parse(value).map(_.some)

  def parse(value: String): Either[String, String] =
    val invalid =
      s"$EnvironmentName must be an HTTPS origin, or an HTTP origin on localhost, without credentials, a path, query, or fragment"

    Try(URI(value)).toOption match
      case None => Left(invalid)
      case Some(uri) =>
        val scheme = Option(uri.getScheme).map(_.toLowerCase)
        val host = Option(uri.getHost).map(_.toLowerCase)
        val pathIsOrigin = Option(uri.getRawPath).forall(path => path.isEmpty || path == "/")
        val port = uri.getPort
        val transportIsSafe = (scheme, host) match
          case (Some("https"), Some(_)) => true
          case (Some("http"), Some(name)) => isLocalHostname(name)
          case _ => false

        if
          value != value.trim ||
          uri.isOpaque ||
          host.forall(_.isEmpty) ||
          Option(uri.getRawUserInfo).nonEmpty ||
          !pathIsOrigin ||
          Option(uri.getRawQuery).nonEmpty ||
          Option(uri.getRawFragment).nonEmpty ||
          port > 65535 ||
          !transportIsSafe
        then Left(invalid)
        else
          val normalizedPort =
            if scheme.contains("https") && port == 443 || scheme.contains("http") && port == 80 then -1
            else port
          Try(URI(scheme.get, null, host.get, normalizedPort, null, null, null).toASCIIString).toEither
            .left
            .map(_ => invalid)

  private def isLocalHostname(host: String) =
    host == "localhost" ||
      host == "127.0.0.1" ||
      host == "[::1]" ||
      host.endsWith(".localhost")
