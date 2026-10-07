/**
 * Text in which each named player links to his page: a trade headline with
 * four players has four links, not one.
 */
import { Fragment } from 'react';
import { Link } from 'react-router-dom';

export interface NamedPlayer {
  id: string;
  name: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function LinkedText({
  text,
  players,
  leagueId,
  className = 'font-medium text-ice-50 underline decoration-rink-500 underline-offset-2 hover:text-white hover:decoration-white',
  onNavigate,
}: {
  text: string;
  players: NamedPlayer[];
  leagueId: string;
  className?: string;
  /** Called when a name is clicked (to close a menu, mark something read…). */
  onNavigate?: () => void;
}) {
  const named = players.filter((p) => p.name && text.includes(p.name));
  if (!named.length) return <>{text}</>;
  // Longest names first, so "Jan Novak Jr." isn't split at "Jan Novak".
  const byName = new Map(named.map((p) => [p.name, p.id]));
  const pattern = new RegExp(`(${[...byName.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})`, 'g');
  return (
    <>
      {text.split(pattern).map((part, i) => {
        const id = byName.get(part);
        return id ? (
          <Link key={i} to={`/league/${leagueId}/player/${id}`} className={className} onClick={onNavigate}>
            {part}
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}
