/*--------------------------------------------------------------------------------------
 *  PPR Code — статус индекса проекта в titlebar IDE (слева).
 *--------------------------------------------------------------------------------------*/

import '../styles.css';
import type { CSSProperties } from 'react';
import { useIsDark } from '../util/services.js';
import { ProjectIndexControls } from '../sidebar-tsx/ProjectIndexControls.js';

const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export const ProjectIndexTitlebar = () => {
  const isDark = useIsDark();
  return (
    <div
      className={`@@void-scope ${isDark ? 'dark' : ''} flex items-center h-full px-1 text-void-fg-3`}
      style={noDrag}
    >
      <ProjectIndexControls showStatusButton popoverPlacement="bottom-start" />
    </div>
  );
};
