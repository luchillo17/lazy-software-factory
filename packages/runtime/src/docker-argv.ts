/**
 * Pure Docker CLI argv builders for the classic Docker SandboxProvider.
 * Machine-readable flags only (`--format`, `--quiet`); callers parse stdout.
 */

/** Internal workspace path inside every Docker ADW container. */
export const DOCKER_WORKSPACE_PATH = "/workspace" as const;

/** Writable temp inside the read-only root filesystem. */
export const DOCKER_TMP_PATH = "/tmp" as const;

/** Writable cache home for package managers / tooling. */
export const DOCKER_CACHE_PATH = "/home/adw/.cache" as const;

export const DOCKER_VOLUME_LABEL = "lazy.software.factory.adw=1" as const;
export const DOCKER_CONTAINER_LABEL = "lazy.software.factory.adw=1" as const;

export interface DockerHardeningMounts {
  readonly workspaceVolume: string;
  readonly tmpSize?: string;
  readonly cacheSize?: string;
}

/**
 * Hardened `docker create` argv (no start). Secrets must not appear here —
 * they enter only via worker launch stdin transport.
 */
export const dockerCreateArgs = (options: {
  readonly name: string;
  readonly image: string;
  readonly mounts: DockerHardeningMounts;
  /** Non-secret container env only (never credentials). */
  readonly env?: Readonly<Record<string, string>>;
  readonly user?: string;
  readonly workdir?: string;
  readonly cmd?: readonly string[];
}): readonly string[] => {
  const tmpSize = options.mounts.tmpSize ?? "256m";
  const cacheSize = options.mounts.cacheSize ?? "512m";
  const user = options.user ?? "adw";
  const workdir = options.workdir ?? DOCKER_WORKSPACE_PATH;
  const cmd = options.cmd ?? ["sleep", "infinity"];

  const args: string[] = [
    "create",
    "--name",
    options.name,
    "--label",
    DOCKER_CONTAINER_LABEL,
    "--read-only",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "--init",
    "--user",
    user,
    "--workdir",
    workdir,
    "--mount",
    `type=volume,source=${options.mounts.workspaceVolume},target=${DOCKER_WORKSPACE_PATH}`,
    "--tmpfs",
    `${DOCKER_TMP_PATH}:rw,noexec,nosuid,size=${tmpSize}`,
    "--tmpfs",
    `${DOCKER_CACHE_PATH}:rw,exec,nosuid,size=${cacheSize}`,
    // No --privileged, no Docker socket mount, no -p / --publish.
  ];

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push("--env", `${key}=${value}`);
    }
  }

  args.push(options.image, ...cmd);
  return args;
};

export const dockerVolumeCreateArgs = (name: string): readonly string[] => [
  "volume",
  "create",
  "--label",
  DOCKER_VOLUME_LABEL,
  name,
];

export const dockerStartArgs = (container: string): readonly string[] => [
  "start",
  container,
];

export const dockerRmArgs = (container: string): readonly string[] => [
  "rm",
  "--force",
  container,
];

export const dockerVolumeRmArgs = (volume: string): readonly string[] => [
  "volume",
  "rm",
  "--force",
  volume,
];

export const dockerKillArgs = (container: string): readonly string[] => [
  "kill",
  container,
];

/** `docker exec -i` with stdin for the worker protocol (secrets on stdin only). */
export const dockerExecInteractiveArgs = (options: {
  readonly container: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly workdir?: string;
  readonly user?: string;
}): readonly string[] => {
  const args: string[] = ["exec", "--interactive"];
  if (options.workdir) {
    args.push("--workdir", options.workdir);
  }
  if (options.user) {
    args.push("--user", options.user);
  }
  args.push(options.container, options.command, ...options.args);
  return args;
};

/** Inspect one container as a JSON object (`--format '{{json .}}'`). */
export const dockerInspectContainerArgs = (
  container: string
): readonly string[] => ["inspect", "--format", "{{json .}}", container];

/** Quiet container id list (machine-readable ids only). */
export const dockerPsQuietArgs = (options?: {
  readonly all?: boolean;
  readonly filter?: string;
}): readonly string[] => {
  const args: string[] = ["ps", "--quiet"];
  if (options?.all) {
    args.push("--all");
  }
  if (options?.filter) {
    args.push("--filter", options.filter);
  }
  return args;
};
