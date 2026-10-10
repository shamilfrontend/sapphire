/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { errorDetails } from '../../../../common/sendLLMMessageTypes.js';

export const ErrorDisplay = ({
  message: message_,
  fullError,
  onDismiss,
  showDismiss,
}: {
  message: string;
  fullError: Error | null;
  onDismiss: (() => void) | null;
  showDismiss?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const details = errorDetails(fullError);
  const isExpandable = !!details;

  const message = `${message_}`;

  return (
    <div className="rounded-lg border border-void-danger-border bg-void-danger-muted p-4 overflow-auto text-void-fg-1">
      {/* Шапка */}
      <div className="flex items-start justify-between">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 text-void-danger mt-0.5 shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-void-fg-1">
              {/* заголовок «Ошибка» */}
              Ошибка
            </h3>
            <p className="text-void-fg-2 mt-1">
              {/* текст сообщения об ошибке */}
              {message}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {isExpandable && (
            <button
              className="text-void-danger hover:opacity-80 p-1 rounded"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          )}
          {showDismiss && onDismiss && (
            <button className="text-void-danger hover:opacity-80 p-1 rounded" onClick={onDismiss}>
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Раскрывающиеся детали */}
      {isExpanded && details && (
        <div className="mt-4 space-y-3 border-t border-void-danger-border pt-3 overflow-auto">
          <div>
            <span className="font-semibold text-void-fg-1">Полная ошибка: </span>
            <pre className="text-void-fg-2">{details}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
