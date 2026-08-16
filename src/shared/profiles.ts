// Perfiles de comandos editables por el usuario (profiles.json en userData).

export interface CommandProfile {
  label: string
  commands: string[]
  cwd?: string
}

export interface ProfilesResult {
  path: string
  profiles: CommandProfile[]
}
