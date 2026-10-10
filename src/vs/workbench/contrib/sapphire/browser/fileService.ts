import { localize2 } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { messageOfSelection } from '../common/prompt/prompts.js';
import { ISapphireModelService } from '../common/sapphireModelService.js';
import { IOfficeExtractService } from '../common/officeExtractService.js';

class FilePromptActionService extends Action2 {
  private static readonly SAPPHIRE_COPY_FILE_PROMPT_ID = 'sapphire.copyfileprompt';

  constructor() {
    super({
      id: FilePromptActionService.SAPPHIRE_COPY_FILE_PROMPT_ID,
      title: localize2('sapphireCopyPrompt', 'Sapphire: Copy Prompt'),
      menu: [
        {
          id: MenuId.ExplorerContext,
          group: '8_void',
          order: 1,
        },
      ],
    });
  }

  async run(accessor: ServicesAccessor, uri: URI): Promise<void> {
    try {
      const fileService = accessor.get(IFileService);
      const clipboardService = accessor.get(IClipboardService);
      const directoryStrService = accessor.get(IDirectoryStrService);
      const sapphireModelService = accessor.get(ISapphireModelService);
      const officeExtractService = accessor.get(IOfficeExtractService);
      const extractOffice = (fileUri: URI) => officeExtractService.extractIfOffice(fileUri);

      const stat = await fileService.stat(uri);

      const folderOpts = {
        maxChildren: 1000,
        maxCharsPerFile: 2_000_000,
      } as const;

      let m: string = 'No contents detected';
      if (stat.isFile) {
        m = await messageOfSelection(
          {
            type: 'File',
            uri,
            language: (await sapphireModelService.getModelSafe(uri)).model?.getLanguageId() || '',
          },
          {
            folderOpts,
            directoryStrService,
            fileService,
            extractOffice,
          },
        );
      }

      if (stat.isDirectory) {
        m = await messageOfSelection(
          {
            type: 'Folder',
            uri,
          },
          {
            folderOpts,
            fileService,
            directoryStrService,
            extractOffice,
          },
        );
      }

      await clipboardService.writeText(m);
    } catch (error) {
      const notificationService = accessor.get(INotificationService);
      notificationService.error(`${error}`);
    }
  }
}

registerAction2(FilePromptActionService);
