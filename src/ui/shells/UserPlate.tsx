import { Avatar } from '../components/Avatar'

export type ShellUser = { name: string; roleLabel: string; avatarUrl: string | null }

/** Avatar, nome e papel de quem está no painel. */
export function UserPlate({ user }: { user: ShellUser }) {
  return (
    <div className="af-userplate">
      <Avatar name={user.name} src={user.avatarUrl} size="md" />
      <span className="af-userplate__text">
        <span className="af-userplate__name">{user.name}</span>
        <span className="af-userplate__role">{user.roleLabel}</span>
      </span>
    </div>
  )
}
