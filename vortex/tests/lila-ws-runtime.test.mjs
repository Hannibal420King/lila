import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(
    new URL("../../vortex.manifest.json", import.meta.url),
    "utf8",
  ),
);
const compose = await readFile(
  new URL("../../docker-compose.yml", import.meta.url),
  "utf8",
);
const service = manifest.deployment.services.find(
  ({ name }) => name === "lila-ws",
);
const runtimeVolume = manifest.deployment.volumes.find(
  ({ name }) => name === "lila-ws-runtime",
);
const tmpVolume = manifest.deployment.volumes.find(
  ({ name }) => name === "lila-ws-tmp",
);

test("declares a dedicated executable lila-ws runtime volume", () => {
  assert.equal(manifest.revision, 7);
  assert.deepEqual(runtimeVolume, {
    name: "lila-ws-runtime",
    kind: "PERSISTENT",
    quotaBytes: "268435456",
    ownerUid: 1001,
    ownerGid: 1001,
  });
  assert.deepEqual(tmpVolume, { name: "lila-ws-tmp", kind: "EPHEMERAL" });
  assert.deepEqual(
    service.mounts.find(({ volume }) => volume === "lila-ws-runtime"),
    {
      volume: "lila-ws-runtime",
      target: "/opt/lila-ws-runtime",
      readOnly: false,
    },
  );
  assert.deepEqual(
    service.mounts.find(({ volume }) => volume === "lila-ws-tmp"),
    { volume: "lila-ws-tmp", target: "/tmp", readOnly: false },
  );
  assert.equal(service.readOnlyRootfs, true);
});

test("confines native extraction to an app-private runtime subtree", () => {
  const command = service.command[0];
  assert.equal(
    service.environment.LILA_WS_NATIVE_WORKDIR,
    "/opt/lila-ws-runtime/netty-native",
  );
  assert.match(
    command,
    /\[ "\$\{runtime_dir\}" = \/opt\/lila-ws-runtime\/netty-native \]/,
  );
  assert.match(command, /rm -rf -- "\$\{runtime_dir\}"/);
  assert.match(command, /mkdir -m 0700 -- "\$\{runtime_dir\}"/);
  assert.match(
    command,
    /-Dreactivemongo\.io\.netty\.native\.workdir="\$\{runtime_dir\}"/,
  );
  assert.match(command, /-Dio\.netty\.native\.workdir="\$\{runtime_dir\}"/);
  assert.doesNotMatch(
    command,
    /chmod|chown|rm -rf -- \/opt\/lila-ws-runtime(?:\s|$)/,
  );
});

test("keeps the Compose fixture aligned with the managed runtime", () => {
  assert.match(compose, /lila-ws-runtime:\/opt\/lila-ws-runtime/);
  assert.match(compose, /lila-ws-tmp:\/tmp/);
  assert.match(compose, /chown 1001:1001 \/opt\/lila-ws-runtime/);
  assert.match(compose, /cap_drop:\s+- ALL/);
  assert.match(compose, /cap_add:\s+- CHOWN\s+- FOWNER/);
  assert.match(compose, /network_mode: none/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(
    compose,
    /LILA_WS_NATIVE_WORKDIR: \/opt\/lila-ws-runtime\/netty-native/,
  );
  assert.match(
    compose,
    /-Dreactivemongo\.io\.netty\.native\.workdir="\$\$\{runtime_dir\}"/,
  );
  assert.match(compose, /-Dio\.netty\.native\.workdir="\$\$\{runtime_dir\}"/);
});

const runDockerTests = process.env.VORTEX_DOCKER_TESTS === "1";

test(
  "prepares and executes from a 1001:1001 volume as image user 1001:0",
  { skip: runDockerTests ? false : "set VORTEX_DOCKER_TESTS=1" },
  () => {
    const dockerInfo = spawnSync(
      "docker",
      ["info", "--format", "{{.ServerVersion}}"],
      {
        encoding: "utf8",
      },
    );
    assert.equal(dockerInfo.status, 0, dockerInfo.stderr || dockerInfo.stdout);

    const image = service.image.reference;
    const volume = `lila-ws-runtime-test-${process.pid}-${Date.now()}`;
    const setup = service.command[0].split(
      " && exec /opt/docker/bin/lila-ws ",
    )[0];

    try {
      const created = spawnSync("docker", ["volume", "create", volume], {
        encoding: "utf8",
      });
      assert.equal(created.status, 0, created.stderr || created.stdout);

      const initialized = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--user",
          "0:0",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "CHOWN",
          "--cap-add",
          "FOWNER",
          "--network",
          "none",
          "--security-opt",
          "no-new-privileges",
          "--mount",
          `type=volume,source=${volume},target=/opt/lila-ws-runtime`,
          "--entrypoint",
          "/bin/sh",
          image,
          "-c",
          "chown 1001:1001 /opt/lila-ws-runtime && chmod 0750 /opt/lila-ws-runtime",
        ],
        { encoding: "utf8" },
      );
      assert.equal(
        initialized.status,
        0,
        initialized.stderr || initialized.stdout,
      );

      const probe = [
        setup,
        'test "$(stat -c %u:%g:%a /opt/lila-ws-runtime)" = "1001:1001:750"',
        'test "$(stat -c %u:%g:%a /opt/lila-ws-runtime/netty-native)" = "1001:0:700"',
        "cp /bin/true /opt/lila-ws-runtime/netty-native/native-probe",
        "chmod 0700 /opt/lila-ws-runtime/netty-native/native-probe",
        "/opt/lila-ws-runtime/netty-native/native-probe",
      ].join(" && ");
      const prepared = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--read-only",
          "--user",
          "1001:0",
          "--env",
          `LILA_WS_NATIVE_WORKDIR=${service.environment.LILA_WS_NATIVE_WORKDIR}`,
          "--mount",
          `type=volume,source=${volume},target=/opt/lila-ws-runtime`,
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,nodev,size=32m",
          "--entrypoint",
          "/bin/sh",
          image,
          "-c",
          probe,
        ],
        { encoding: "utf8" },
      );
      assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
    } finally {
      spawnSync("docker", ["volume", "rm", "--force", volume], {
        encoding: "utf8",
      });
    }
  },
);
