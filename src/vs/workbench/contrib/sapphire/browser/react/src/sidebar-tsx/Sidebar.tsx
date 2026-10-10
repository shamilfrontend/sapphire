/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useIsDark, useSettingsState } from '../util/services.js';

import '../styles.css';
import { SidebarChat } from './SidebarChat.js';
import { SidebarChatTabs } from './SidebarChatTabs.js';
import ErrorBoundary from './ErrorBoundary.js';

export const Sidebar = ({ className: _className }: { className: string }) => {
  const isDark = useIsDark();
  const layoutMode = useSettingsState().globalSettings.layoutMode;
  return (
    <div
      className={`@@void-scope ${isDark ? 'dark' : ''}`}
      style={{ width: '100%', height: '100%' }}
    >
      <div
        // базовые фон и текст сайдбара
        className={`
				w-full h-full
				bg-void-bg-2
				text-void-fg-1
			`}
      >
        <div className="w-full h-full flex flex-col">
          <ErrorBoundary>
            <SidebarChatTabs />
          </ErrorBoundary>
          <div className="min-h-0 flex-1 h-full">
            {/* В режиме agents чат рисуется в отдельном окне; здесь только вкладки */}
            <ErrorBoundary>{layoutMode === 'agents' ? null : <SidebarChat />}</ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
};
