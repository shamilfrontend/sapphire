/*--------------------------------------------------------------------------------------
 *  PPR Code — plan preview beside the chat in Режим Агент.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename } from '../../../../common/pathLabels.js';
import {
  parsePlanMarkdown,
  type ParsedPlanMarkdown,
} from '../../../../common/prompt/planFileHelpers.js';
import { PlanEditorChrome, type PlanEditorMode } from '../plan-editor-tsx/PlanEditor.js';
import { useAccessor } from '../util/services.js';

const emptyPlan = (): ParsedPlanMarkdown => ({ name: '', overview: '', plan: '', todos: [] });

export const AgentsPlanPane = ({ fsPath, onClose }: { fsPath: string; onClose: () => void }) => {
  const accessor = useAccessor();
  const sapphireModelService = accessor.get('ISapphireModelService');
  const uri = useMemo(() => URI.file(fsPath), [fsPath]);
  // Блокирует echo onDidChangeContent при записи из textarea в модель редактора.
  const writingRef = useRef(false);
  const [mode, setMode] = useState<PlanEditorMode>('preview');
  const [status, setStatus] = useState<'loading' | 'missing' | 'ready'>('loading');
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedPlanMarkdown>(emptyPlan);

  useEffect(() => {
    let cancelled = false;
    setMode('preview');
    setStatus('loading');
    void sapphireModelService.getModelSafe(uri).then((result) => {
      if (cancelled) return;
      const model = result.model;
      if (!model) {
        setStatus('missing');
        setRaw('');
        setParsed(emptyPlan());
        return;
      }
      const value = model.getValue();
      setRaw(value);
      setParsed(parsePlanMarkdown(value));
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [uri, sapphireModelService]);

  useEffect(() => {
    if (status !== 'ready') return;
    const model = sapphireModelService.getModel(uri).model;
    if (!model) return;
    const subscription = model.onDidChangeContent(() => {
      if (writingRef.current) return;
      const value = model.getValue();
      setRaw(value);
      setParsed(parsePlanMarkdown(value));
    });
    return () => subscription.dispose();
  }, [status, uri, sapphireModelService]);

  const onMarkdownChange = (value: string) => {
    setRaw(value);
    setParsed(parsePlanMarkdown(value));
    const model = sapphireModelService.getModel(uri).model;
    if (!model || model.getValue() === value) return;
    writingRef.current = true;
    model.setValue(value);
    writingRef.current = false;
  };

  const onMarkdownKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      void sapphireModelService.saveModel(uri);
    }
  };

  const label = getBasename(fsPath);

  return (
    <aside className="flex-1 min-w-[320px] h-full min-h-0 flex flex-col border-l border-void-border-2 bg-void-bg-3">
      <div className="h-9 shrink-0 flex items-center gap-2 px-2 border-b border-void-border-2">
        <span className="text-sm text-void-fg-1 truncate flex-1 min-w-0" title={fsPath}>
          {label}
        </span>
        <button
          type="button"
          title="Свернуть"
          aria-label="Свернуть"
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {status === 'ready' ? (
          <PlanEditorChrome
            mode={mode}
            name={parsed.name}
            overview={parsed.overview}
            plan={parsed.plan}
            todos={parsed.todos}
            planUriFsPath={fsPath}
            onModeChange={setMode}
            markdownBody={
              <textarea
                value={raw}
                onChange={(event) => onMarkdownChange(event.target.value)}
                onKeyDown={onMarkdownKeyDown}
                spellCheck={false}
                aria-label="Markdown плана"
                className="w-full h-full resize-none bg-void-bg-1 text-void-fg-1 font-mono text-[13px] leading-relaxed p-4 focus:outline-none"
              />
            }
          />
        ) : (
          <div className="p-4 text-sm text-void-fg-3">
            {status === 'missing' ? 'Файл недоступен' : 'Загрузка…'}
          </div>
        )}
      </div>
    </aside>
  );
};
