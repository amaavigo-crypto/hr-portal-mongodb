import React, { useCallback, useEffect, useState } from 'react';
import { User } from '../types';
import type { GameId } from '../../shared/wellbeingEngine';
import { wellbeingService, type Me } from '../services/wellbeingService';
import { Loading, useLoad } from './common/loadUi';
import { wellbeingNav, wellbeingNavItems, type WbSection } from './wellbeing/wellbeingNav';
import { Consent, PlayHub, Progress } from './wellbeing/screens';
import { GameShell } from './wellbeing/GameShell';
import { HrOverview, HrPeople, RoleProfiles, WellbeingSettings } from './wellbeing/hr';

/** Wellbeing: short games for a break (everyone) and, for HR, group results, role skills, a logged per-person view and settings. */
export const WellbeingModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const { data: me, error, loading, reload } = useLoad<Me>(() => wellbeingService.me(), [currentUser.id]);
  const [game, setGame] = useState<GameId | null>(null);
  const [editConsent, setEditConsent] = useState(false);
  const { section: chosen } = wellbeingNav.useNav();

  const items = me ? wellbeingNavItems(me.access) : [];
  const itemsKey = items.map((i) => i.key).join(',');
  useEffect(() => { wellbeingNav.publish(items); }, [itemsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => wellbeingNav.publish([]), []);
  // Leaving the Play section ends a game screen.
  const section = (items.length ? wellbeingNav.resolve(chosen, items) : 'play') as WbSection;
  useEffect(() => { if (section !== 'play') setGame(null); }, [section]);
  const refresh = useCallback(() => { void reload(); }, [reload]);

  if (!me) return <div className="flex-1 overflow-y-auto p-4 sm:p-6"><Loading error={error} loading={loading} /></div>;

  const body = (() => {
    if (editConsent || (!me.consent.answered && (section === 'play' || section === 'progress'))) {
      return <Consent me={me} onDone={() => { setEditConsent(false); refresh(); }} onCancel={me.consent.answered ? () => setEditConsent(false) : undefined} />;
    }
    switch (section) {
      case 'progress': return <Progress onChangeConsent={() => setEditConsent(true)} onChanged={refresh} />;
      case 'overview': return <HrOverview />;
      case 'roles': return <RoleProfiles />;
      case 'people': return <HrPeople />;
      case 'settings': return <WellbeingSettings onChanged={refresh} />;
      default: {
        const g = game ? me.games.find((x) => x.id === game) : null;
        if (g) return <GameShell key={g.id} game={g} me={me} onExit={() => { setGame(null); refresh(); }} onChanged={refresh} />;
        return <PlayHub me={me} onPick={setGame} onChangeConsent={() => setEditConsent(true)} />;
      }
    }
  })();

  return <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50">{body}</div>;
};
