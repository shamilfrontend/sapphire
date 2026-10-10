/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { DIVIDER, FINAL, ORIGINAL } from '../prompt/prompts.js';

class SurroundingsRemover {
  readonly originalS: string;

  i: number;

  j: number;

  // подстрока s[i…j]

  constructor(s: string) {
    this.originalS = s;
    this.i = 0;
    this.j = s.length - 1;
  }

  value() {
    return this.originalS.substring(this.i, this.j + 1);
  }

  // true, если сняли весь prefix целиком
  removePrefix = (prefix: string): boolean => {
    let offset = 0;
    // console.log('prefix', prefix, Math.min(this.j, prefix.length - 1))
    while (this.i <= this.j && offset <= prefix.length - 1) {
      if (this.originalS.charAt(this.i) !== prefix.charAt(offset)) break;
      offset += 1;
      this.i += 1;
    }
    return offset === prefix.length;
  };

  // // removes suffix from right to left
  removeSuffix = (suffix: string): boolean => {
    // напр. suffix = <PRE/>, строка <PRE>hi<P
    const s = this.value();
    // все префиксы suffix — проверяем суффикс строки
    for (let len = Math.min(s.length, suffix.length); len >= 1; len -= 1) {
      if (s.endsWith(suffix.substring(0, len))) {
        // хвост строки совпал с префиксом suffix
        this.j -= len;
        return len === suffix.length;
      }
    }
    return false;
  };
  // removeSuffix = (suffix: string): boolean => {
  // 	let offset = 0

  // 	while (this.j >= Math.max(this.i, 0)) {
  // 		if (this.originalS.charAt(this.j) !== suffix.charAt(suffix.length - 1 - offset))
  // 			break
  // 		offset += 1
  // 		this.j -= 1
  // 	}
  // 	return offset === suffix.length
  // }

  // либо сдвигаем i до until (и опционально за него), либо false
  removeFromStartUntilFullMatch = (until: string, alsoRemoveUntilStr: boolean) => {
    const index = this.originalS.indexOf(until, this.i);

    if (index === -1) {
      // this.i = this.j + 1
      return false;
    }
    // console.log('index', index, until.length)

    if (alsoRemoveUntilStr) this.i = index + until.length;
    else this.i = index;

    return true;
  };

  removeCodeBlock = () => {
    // Варианты fenced block:
    // 1. ```language\n<code>\n```\n?
    // 2. ```<code>\n```\n?

    const pm = this;
    const foundCodeBlock = pm.removePrefix('```');
    if (!foundCodeBlock) return false;

    pm.removeFromStartUntilFullMatch('\n', true); // пропуск language после ```

    const j = pm.j;
    let foundCodeBlockEnd = pm.removeSuffix('```');

    if (pm.j === j) foundCodeBlockEnd = pm.removeSuffix('```\n'); // без сдвига — пробуем ```\n

    if (!foundCodeBlockEnd) return false;

    pm.removeSuffix('\n'); // \n перед закрывающими ```
    return true;
  };

  deltaInfo = (recentlyAddedTextLen: number) => {
    // aaaaaatextaaaaaa{recentlyAdded}
    //                  ^   i    j
    //                  |
    //            recentlyAddedIdx
    const recentlyAddedIdx = this.originalS.length - recentlyAddedTextLen;
    const actualDelta = this.originalS.substring(Math.max(this.i, recentlyAddedIdx), this.j + 1);
    const ignoredSuffix = this.originalS.substring(
      Math.max(this.j + 1, recentlyAddedIdx),
      Infinity,
    );
    return [actualDelta, ignoredSuffix] as const;
  };
}

export const extractCodeFromRegular = ({
  text,
  recentlyAddedTextLen,
}: {
  text: string;
  recentlyAddedTextLen: number;
}): [string, string, string] => {
  const pm = new SurroundingsRemover(text);

  pm.removeCodeBlock();

  const s = pm.value();
  const [delta, ignoredSuffix] = pm.deltaInfo(recentlyAddedTextLen);

  return [s, delta, ignoredSuffix];
};

// FIM prefix/suffix для gateway /v1/completions
export const extractCodeFromFIM = ({
  text,
  recentlyAddedTextLen,
  midTag,
}: {
  text: string;
  recentlyAddedTextLen: number;
  midTag: string;
}): [string, string, string] => {
  /* ------------- схема разбора FIM -------------
		[опционально ` | `` | ```]
		(опциональный language)
		[мусор]
		[<MID>]
		(тело между тегами)
		[</MID>]
		[опционально ` | `` | ```]
	*/

  const pm = new SurroundingsRemover(text);

  pm.removeCodeBlock();

  const foundMid = pm.removePrefix(`<${midTag}>`);

  if (foundMid) {
    pm.removeSuffix(`\n`); // модель иногда добавляет \n
    pm.removeSuffix(`</${midTag}>`);
  }
  const s = pm.value();
  const [delta, ignoredSuffix] = pm.deltaInfo(recentlyAddedTextLen);

  return [s, delta, ignoredSuffix];
};

export type ExtractedSearchReplaceBlock = {
  state: 'writingOriginal' | 'writingFinal' | 'done';
  orig: string;
  final: string;
};

// JS substring: при end < start substring даёт не '' — учитываем в sapphireSubstr
const sapphireSubstr = (str: string, start: number, end: number) =>
  end < start ? '' : str.substring(start, end);

export const endsWithAnyPrefixOf = (str: string, anyPrefix: string) => {
  // перебор префиксов anyPrefix от длинного к короткому
  for (let i = anyPrefix.length; i >= 1; i--) {
    // i >= 1 — пустой префикс не проверяем
    const prefix = anyPrefix.slice(0, i);
    if (str.endsWith(prefix)) return prefix;
  }
  return null;
};

// при дозаписи str длина blocks только растёт, state не откатывается
export const extractSearchReplaceBlocks = (str: string) => {
  const ORIGINAL_ = `${ORIGINAL}\n`;
  const DIVIDER_ = `\n${DIVIDER}\n`;
  // FINAL_: предпочитаем '\n' + FINAL, но учитываем пустой final

  const blocks: ExtractedSearchReplaceBlock[] = [];

  let i = 0; // поиск с индекса i (не по номерам строк — проще)
  while (true) {
    let origStart = str.indexOf(ORIGINAL_, i);
    if (origStart === -1) {
      return blocks;
    }
    origStart += ORIGINAL_.length;
    i = origStart;
    // нашли ORIGINAL\n

    let dividerStart = str.indexOf(DIVIDER_, i);
    if (dividerStart === -1) {
      // DIVIDER_ ещё нет — пишем original или частичный DIVIDER_
      const writingDIVIDERlen = endsWithAnyPrefixOf(str, DIVIDER_)?.length ?? 0;
      blocks.push({
        orig: sapphireSubstr(str, origStart, str.length - writingDIVIDERlen),
        final: '',
        state: 'writingOriginal',
      });
      return blocks;
    }
    const origStrDone = sapphireSubstr(str, origStart, dividerStart);
    dividerStart += DIVIDER_.length;
    i = dividerStart;
    // нашли DIVIDER

    const fullFINALStart = str.indexOf(FINAL, i);
    const fullFINALStart_ = str.indexOf(`\n${FINAL}`, i); // предпочитаем \n+FINAL, иначе голый FINAL
    const matchedFullFINAL_ = fullFINALStart_ !== -1 && fullFINALStart === fullFINALStart_ + 1; // иначе FINAL найдётся слишком поздно в строке

    let finalStart = matchedFullFINAL_ ? fullFINALStart_ : fullFINALStart;
    if (finalStart === -1) {
      // FINAL ещё нет — пишем final или частичный FINAL
      const writingFINALlen = endsWithAnyPrefixOf(str, FINAL)?.length ?? 0;
      const writingFINALlen_ = endsWithAnyPrefixOf(str, `\n${FINAL}`)?.length ?? 0; // приоритет у \n+FINAL
      const usingWritingFINALlen = Math.max(writingFINALlen, writingFINALlen_);
      blocks.push({
        orig: origStrDone,
        final: sapphireSubstr(str, dividerStart, str.length - usingWritingFINALlen),
        state: 'writingFinal',
      });
      return blocks;
    }
    const usingFINAL = matchedFullFINAL_ ? `\n${FINAL}` : FINAL;
    const finalStrDone = sapphireSubstr(str, dividerStart, finalStart);
    finalStart += usingFINAL.length;
    i = finalStart;
    // блок завершён (FINAL)

    blocks.push({
      orig: origStrDone,
      final: finalStrDone,
      state: 'done',
    });
  }
};
