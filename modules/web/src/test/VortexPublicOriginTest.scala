package lila.web

import lila.core.config.AssetDomain

class VortexPublicOriginTest extends munit.FunSuite:

  test("accept and normalize secure and local development origins"):
    assertEquals(VortexPublicOrigin.parse("https://VORTEX.example:443/"), Right("https://vortex.example"))
    assertEquals(VortexPublicOrigin.parse("http://vortex.localhost:8180"), Right("http://vortex.localhost:8180"))
    assertEquals(VortexPublicOrigin.parse("http://127.0.0.1:8180/"), Right("http://127.0.0.1:8180"))
    assertEquals(VortexPublicOrigin.parse("http://[::1]:8180"), Right("http://[::1]:8180"))

  test("preserve standalone mode when the public origin is absent"):
    assertEquals(VortexPublicOrigin.configured(Map.empty), Right(None))
    assertEquals(VortexPublicOrigin.configured(Map(VortexPublicOrigin.EnvironmentName -> "")), Right(None))

  test("reject origins that could weaken or inject the CSP"):
    val invalid = List(
      "http://vortex.example",
      "https://user:password@vortex.example",
      "https://vortex.example/sdk",
      "https://vortex.example/?next=1",
      "https://vortex.example/#fragment",
      "javascript:alert(1)",
      "//vortex.example",
      "https://vortex.example:65536",
      " https://vortex.example",
      "https://vortex.example; script-src *",
      "https://vortex.example' 'unsafe-inline'"
    )
    invalid.foreach: value =>
      assert(VortexPublicOrigin.parse(value).isLeft, value)

  test("add the validated origin only to script-src and connect-src"):
    val origin = "https://vortex.example"
    val csp = ContentSecurityPolicy.page(AssetDomain("lila.example"), List("wss://socket.example"), origin.some)

    assertEquals(csp.scriptSrc.count(_ == origin), 1)
    assertEquals(csp.connectSrc.count(_ == origin), 1)
    assertEquals(
      List(csp.defaultSrc, csp.styleSrc, csp.frameSrc, csp.workerSrc, csp.imgSrc, csp.mediaSrc, csp.fontSrc, csp.baseUri)
        .flatten
        .count(_ == origin),
      0
    )

    val standalone = ContentSecurityPolicy.page(AssetDomain("lila.example"), Nil, none)
    assert(!standalone.scriptSrc.contains(origin))
    assert(!standalone.connectSrc.contains(origin))
