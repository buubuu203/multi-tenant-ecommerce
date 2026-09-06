'use client';

import { useEffect, useState } from 'react';

const tabs = [
  ['branding', 'Branding'],
  ['payments', 'Payments'],
  ['bank-transfer', 'Bank transfer'],
  ['shipping', 'Shipping'],
  ['catalog', 'Catalog'],
  ['orders', 'Orders'],
] as const;

export function AdminTabs() {
  const [activeTab, setActiveTab] = useState('branding');

  useEffect(() => {
    const updateTab = () => {
      const requested = window.location.hash.slice(1);
      const next = tabs.some(([id]) => id === requested) ? requested : 'branding';
      setActiveTab(next);
      for (const [id] of tabs) {
        const section = document.getElementById(id);
        if (section) section.hidden = id !== next;
      }
    };

    updateTab();
    window.addEventListener('hashchange', updateTab);
    return () => window.removeEventListener('hashchange', updateTab);
  }, []);

  return (
    <nav className="sticky top-0 z-10 -mx-6 flex gap-1 overflow-x-auto border-b border-border bg-background/95 px-6 py-2 backdrop-blur-sm sm:-mx-0 sm:rounded-lg sm:border sm:px-2">
      {tabs.map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={() => setActiveTab(id)}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
            activeTab === id
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
          }`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
