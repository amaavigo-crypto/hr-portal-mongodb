import React, { useState } from 'react';
import { User } from '../../../types';
import { OnboardingModule } from '../../OnboardingModule';
import { JoiningTab } from '../JoiningTab';
import { Segmented } from './Segmented';
import { TAB_KEY } from './HiringHome';

type View = 'documents' | 'joining';

/** Everything after the offer: joiners' documents and accounts, and the joining checklist. */
export const HiringOnboarding: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const [view, setView] = useState<View>(() => {
    try { if (sessionStorage.getItem(TAB_KEY) === 'joining') { sessionStorage.removeItem(TAB_KEY); return 'joining'; } } catch { /* first view */ }
    return 'documents';
  });
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="px-4 pt-4 sm:px-8">
        <Segmented<View> label="Onboarding views" value={view} onChange={setView} options={[{ value: 'documents', label: 'New joiners' }, { value: 'joining', label: 'Joining' }]} />
      </div>
      {view === 'documents' ? <OnboardingModule currentUser={currentUser} /> : <div className="px-4 py-5 sm:px-8"><JoiningTab /></div>}
    </div>
  );
};
