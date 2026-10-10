/*--------------------------------------------------------------------------------------
 *  PPR Code — fullscreen Режим Агент (chat-first shell).
 *--------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  Folder,
  FolderPlus,
  PanelLeft,
  Plus,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import { isMacintosh, isNative } from '../../../../../../../base/common/platform.js';
import {
  useAccessor,
  useChatThreadsState,
  useCommandBarState,
  useIsDark,
  useSettingsState,
} from '../util/services.js';
import { threadTitle } from '../util/threadDisplay.js';
import ErrorBoundary from '../sidebar-tsx/ErrorBoundary.js';
import { SidebarChat } from '../sidebar-tsx/SidebarChat.js';
import { SidebarChatTabs } from '../sidebar-tsx/SidebarChatTabs.js';
import { Settings } from '../void-settings-tsx/Settings.js';
import { AgentsReviewProvider } from './AgentsReviewContext.js';
import { AgentsReviewPane, reviewFilesLabel } from './AgentsReviewPane.js';
import { AgentsPlanProvider } from './AgentsPlanContext.js';
import { AgentsPlanPane } from './AgentsPlanPane.js';
import { AgentsThreadTree } from './AgentsThreadTree.js';

const SIDEBAR_KEY = 'ppr.agentsSidebarCollapsed';
const noDrag = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const workspaceLabel = (workspaceService: {
  getWorkspace: () => { folders: { name: string; uri: { fsPath: string } }[] };
}) => {
  const folders = workspaceService.getWorkspace().folders;
  if (folders.length === 0) return { empty: true, name: '', path: '' };
  return {
    empty: false,
    name: folders.map((folder) => folder.name).join(', '),
    path: folders.map((folder) => folder.uri.fsPath).join('\n'),
  };
};

const OpenFolderButton = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="shrink-0 cursor-pointer rounded-full px-3 py-1 text-sm bg-[#00b0cc] text-white hover:bg-[#0097b2]"
    style={noDrag}
  >
    Открыть папку
  </button>
);

const readSidebarCollapsed = (): boolean => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
};

export const AgentsWindow = () => {
  const settings = useSettingsState();
  const isDark = useIsDark();
  const show =
    settings.globalSettings.isOnboardingComplete && settings.globalSettings.layoutMode === 'agents';

  if (!show) return null;

  return (
    <div className={`@@void-scope ${isDark ? 'dark' : ''}`}>
      <div
        className="bg-void-bg-3 text-void-fg-1 fixed top-0 right-0 bottom-0 left-0 z-[99990] flex"
        style={{ height: '100vh', ...noDrag }}
      >
        <ErrorBoundary>
          <AgentsWindowShell />
        </ErrorBoundary>
      </div>
    </div>
  );
};

const AgentsWindowShell = () => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const commandService = accessor.get('ICommandService');
  const sapphireSettingsService = accessor.get('ISapphireSettingsService');
  const workspaceService = accessor.get('IWorkspaceContextService');
  const [query, setQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsActive, setSettingsActive] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const threadsState = useChatThreadsState();
  const { sortedURIs } = useCommandBarState();
  const [workspace, setWorkspace] = useState(() => workspaceLabel(workspaceService));
  const [reviewOpen, setReviewOpen] = useState(false);
  const [planFsPath, setPlanFsPath] = useState<string | null>(null);
  const [selectedFsPath, setSelectedFsPath] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setWorkspace(workspaceLabel(workspaceService));
    update();
    const disposable = workspaceService.onDidChangeWorkspaceFolders(update);
    return () => disposable.dispose();
  }, [workspaceService]);

  // Панель review закрыта, пока пользователь не откроет; сбрасываем устаревший выбор при пустом списке.
  useEffect(() => {
    const count = sortedURIs.length;
    if (count === 0) {
      setReviewOpen(false);
      setSelectedFsPath(null);
      return;
    }
    setSelectedFsPath((current) =>
      current && sortedURIs.some((uri) => uri.fsPath === current) ? current : null,
    );
  }, [sortedURIs]);

  const openReview = useCallback(
    (fsPath?: string) => {
      setPlanFsPath(null);
      setReviewOpen(true);
      if (fsPath) {
        setSelectedFsPath(fsPath);
      } else {
        setSelectedFsPath((current) => current ?? sortedURIs[0]?.fsPath ?? null);
      }
    },
    [sortedURIs],
  );

  const openPlan = useCallback((fsPath: string) => {
    setReviewOpen(false);
    setPlanFsPath(fsPath);
  }, []);

  const openFolder = useCallback(() => {
    void commandService.executeCommand(
      isMacintosh && isNative
        ? 'workbench.action.files.openFileFolder'
        : 'workbench.action.files.openFolder',
    );
  }, [commandService]);

  const headerTitle = settingsActive
    ? 'Настройки'
    : threadTitle(threadsState.allThreads[threadsState.currentThreadId]);

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // localStorage недоступен (квота / приватный режим)
      }
      return next;
    });
  };

  const openSettingsTab = () => {
    setSettingsOpen(true);
    setSettingsActive(true);
  };

  const closeSettingsTab = () => {
    setSettingsOpen(false);
    setSettingsActive(false);
  };

  const leaveSettings = () => setSettingsActive(false);

  const showPlan = !!planFsPath && !settingsActive;
  const showReview = reviewOpen && sortedURIs.length > 0 && !showPlan;
  const showSidePane = showReview || showPlan;

  return (
    <AgentsReviewProvider value={{ openReview, reviewOpen: showReview }}>
      <AgentsPlanProvider value={{ openPlan, planOpen: showPlan }}>
        {!sidebarCollapsed && (
          <aside className="w-[260px] shrink-0 h-full flex flex-col bg-void-bg-2 border-r border-void-border-2">
            <div className="px-3 pt-3 pb-2 flex flex-col gap-2">
              {workspace.empty ? (
                <OpenFolderButton onClick={openFolder} />
              ) : (
                <div className="flex items-center gap-2 min-w-0 px-1" title={workspace.path}>
                  <Folder className="w-4 h-4 shrink-0 text-void-fg-3" />
                  <span className="truncate text-root font-medium text-void-fg-1">
                    {workspace.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  leaveSettings();
                  chatThreadsService.openNewThread();
                }}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm bg-void-bg-1 hover:bg-void-bg-2-alt text-left cursor-pointer"
                style={noDrag}
              >
                <Plus className="w-4 h-4 shrink-0 pointer-events-none" />
                <span className="flex-1 pointer-events-none">Новый чат</span>
              </button>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-md bg-void-bg-1 border border-void-border-2">
                  <Search className="w-3.5 h-3.5 shrink-0 text-void-fg-3" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Поиск чатов"
                    spellCheck={false}
                    className="w-full bg-transparent text-sm text-void-fg-1 placeholder:text-void-fg-3 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  title="Новая папка"
                  aria-label="Новая папка"
                  onClick={() => {
                    const id = chatThreadsService.createFolder('Новая папка', null);
                    setEditingFolderId(id);
                  }}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-void-border-2 bg-void-bg-1 hover:bg-void-bg-2-alt text-void-fg-2"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
              <AgentsThreadTree
                filterText={query}
                editingFolderId={editingFolderId}
                onEditingFolderIdChange={setEditingFolderId}
                onThreadOpen={leaveSettings}
              />
            </div>
          </aside>
        )}

        <main className="flex-1 min-w-0 h-full flex flex-col bg-[var(--void-content-bg)]">
          <header className="h-12 shrink-0 flex items-center gap-2 px-2 border-b border-void-border-2 bg-[var(--void-header-bg)]">
            <button
              type="button"
              title={sidebarCollapsed ? 'Показать список чатов' : 'Скрыть список чатов'}
              aria-label={sidebarCollapsed ? 'Показать список чатов' : 'Скрыть список чатов'}
              aria-pressed={!sidebarCollapsed}
              onClick={toggleSidebar}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {sidebarCollapsed &&
                (workspace.empty ? (
                  <OpenFolderButton onClick={openFolder} />
                ) : (
                  <span
                    className="shrink-0 max-w-[40%] truncate text-root font-medium text-void-fg-1"
                    title={workspace.path}
                  >
                    {workspace.name}
                  </span>
                ))}
              <span
                className={`truncate ${
                  sidebarCollapsed ? 'text-sm text-void-fg-3' : 'text-sm font-medium text-void-fg-1'
                }`}
                title={headerTitle}
              >
                {headerTitle}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {sortedURIs.length > 0 && (
                <button
                  type="button"
                  title="Изменения"
                  aria-label="Изменения"
                  aria-pressed={showReview}
                  onClick={() => {
                    if (showReview) {
                      setReviewOpen(false);
                    } else {
                      openReview();
                    }
                  }}
                  className={`px-2.5 h-8 rounded-md text-sm ${
                    showReview
                      ? 'bg-[#00b0cc]/20 text-void-fg-1 font-medium'
                      : 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2'
                  }`}
                >
                  {reviewFilesLabel(sortedURIs.length)}
                </button>
              )}
              <button
                type="button"
                title="Настройки Sapphire"
                aria-label="Настройки Sapphire"
                onClick={openSettingsTab}
                className={`w-8 h-8 flex items-center justify-center rounded-md ${
                  settingsActive
                    ? 'text-void-fg-1 bg-[#00b0cc]/20'
                    : 'text-void-fg-3 hover:text-void-fg-1 hover:bg-void-bg-2'
                }`}
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => sapphireSettingsService.setGlobalSetting('layoutMode', 'ide')}
                className="px-3 py-1 rounded-full text-sm bg-[#00b0cc] text-white hover:bg-[#0097b2]"
              >
                Режим IDE ↗
              </button>
            </div>
          </header>
          <SidebarChatTabs
            variant="agents"
            showHistoryButton={sidebarCollapsed}
            settingsTab={{ open: settingsOpen, active: settingsActive }}
            onActivateSettings={() => setSettingsActive(true)}
            onCloseSettings={closeSettingsTab}
            onSelectThread={leaveSettings}
          />
          <div className="flex-1 min-h-0 flex">
            <div
              className={`h-full ${
                showSidePane ? 'min-w-[380px] flex-1 max-w-[800px]' : 'flex-1 min-w-0'
              }`}
            >
              {settingsActive ? <Settings variant="agents" /> : <SidebarChat variant="agents" />}
            </div>
            {showReview && (
              <AgentsReviewPane
                selectedFsPath={selectedFsPath}
                onClose={() => setReviewOpen(false)}
              />
            )}
            {showPlan && planFsPath && (
              <AgentsPlanPane fsPath={planFsPath} onClose={() => setPlanFsPath(null)} />
            )}
          </div>
        </main>
      </AgentsPlanProvider>
    </AgentsReviewProvider>
  );
};
