import { useTeamById } from '../pages/LeagueLayout';
import { TeamChip } from './ui';

/** A team's logo and abbreviation, from its id. */
export function TeamTag({ id, className }: { id: string | null | undefined; className?: string }) {
  const t = useTeamById()(id);
  if (!id) return null;
  return (
    <span className={`inline-flex items-center gap-1 align-middle ${className ?? ''}`}>
      {t && <TeamChip team={t} size="sm" />}
      {t?.abbr ?? id}
    </span>
  );
}
