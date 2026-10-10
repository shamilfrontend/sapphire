/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import '../styles.css';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';

/**
 * Глобальные тултипы react-tooltip с единым оформлением.
 * Использование:
 * 1. Смонтировать Tooltip с id, например id='sapphire-tooltip'
 * 2. На элементе указать data-tooltip-id="sapphire-tooltip" и data-tooltip-content="текст"
 */
export const SapphireTooltip = () => {
  return (
    <>
      <style>
        {`
				#void-tooltip, #void-tooltip-orange, #void-tooltip-green, #void-tooltip-provider-info {
					font-size: 12px;
					padding: 0px 8px;
					border-radius: 6px;
					z-index: 999999;
					max-width: 300px;
					word-wrap: break-word;
				}

				#void-tooltip {
					background-color: var(--vscode-editor-background);
					color: var(--vscode-input-foreground);
				}

				#void-tooltip-orange {
					background-color: #F6762A;
					color: white;
				}

				#void-tooltip-green {
					background-color: #228B22;
					color: white;
				}

				#void-tooltip-provider-info {
					background-color: var(--vscode-editor-background);
					color: var(--vscode-input-foreground);
				}

				.react-tooltip-arrow {
					z-index: -1 !important;
				}
				`}
      </style>

      <Tooltip
        id="sapphire-tooltip"
        border="1px solid rgba(100,100,100,.2)"
        opacity={1}
        delayShow={50}
      />
      <Tooltip
        id="sapphire-tooltip-orange"
        border="1px solid rgba(200,200,200,.3)"
        opacity={1}
        delayShow={50}
      />
      <Tooltip
        id="sapphire-tooltip-green"
        border="1px solid rgba(200,200,200,.3)"
        opacity={1}
        delayShow={50}
      />
      <Tooltip
        id="sapphire-tooltip-provider-info"
        border="1px solid rgba(100,100,100,.2)"
        opacity={1}
        delayShow={50}
        style={{
          pointerEvents: 'all',
          userSelect: 'text',
          fontSize: 11,
          maxWidth: '280px',
          paddingTop: '8px',
          paddingBottom: '8px',
        }}
      />
    </>
  );
};
