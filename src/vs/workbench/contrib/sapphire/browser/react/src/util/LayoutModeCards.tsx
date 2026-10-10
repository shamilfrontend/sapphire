/*--------------------------------------------------------------------------------------
 *  PPR Code — выбор layout-режима (Режим IDE / Режим Агент).
 *--------------------------------------------------------------------------------------*/

import { LayoutMode } from '../../../../common/sapphireSettingsTypes.js';

const CARDS: { id: LayoutMode; title: string; description: string }[] = [
  {
    id: 'ide',
    title: 'Режим IDE',
    description: 'Классический редактор кода и чат справа.',
  },
  {
    id: 'agents',
    title: 'Режим Агент',
    description: 'Чат на весь экран: список диалогов слева, сообщение по центру.',
  },
];

export const LayoutModeCards = ({
  value,
  onChange,
}: {
  value: LayoutMode;
  onChange: (mode: LayoutMode) => void;
}) => {
  return (
    <div className="flex flex-col gap-3">
      {CARDS.map((card) => {
        const selected = value === card.id;
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onChange(card.id)}
            className={`text-left rounded-md border p-4 transition-colors ${
              selected
                ? 'border-[#00b0cc] bg-[#00b0cc]/10'
                : 'border-void-border-2 bg-void-bg-2 hover:border-void-border-1'
            }`}
          >
            <div className="text-void-fg-1 font-medium">{card.title}</div>
            <div className="text-void-fg-3 text-sm mt-1">{card.description}</div>
          </button>
        );
      })}
    </div>
  );
};
