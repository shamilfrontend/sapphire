/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Максимум циклов fix→verify в одном ответе агента (подсказка модели, не жёсткий стоп-движок). */
export const VERIFY_UNTIL_GREEN_MAX_ROUNDS = 5;

const VERIFY_SLASH_RE = /(?:^|[\s([{])\/verify\b/i;

export function userRequestedVerifyUntilGreen(userText: string): boolean {
	return VERIFY_SLASH_RE.test(userText || '');
}

export function shouldApplyVerifyUntilGreen(
	chatMode: string,
	settingEnabled: boolean,
	userText: string,
): boolean {
	if (chatMode !== 'agent') {
		return false;
	}
	return settingEnabled || userRequestedVerifyUntilGreen(userText);
}

export function verifyUntilGreenPrompt(maxRounds: number = VERIFY_UNTIL_GREEN_MAX_ROUNDS): string {
	return `VERIFY-UNTIL-GREEN ritual (active for this turn):
After you edit code, do not end the turn until checks are green or you hit the round limit.
1. Call get_diagnostics (or read_lint_errors for one known file) on the files you changed.
2. If the project has an obvious test/typecheck/lint command the user already uses (package.json scripts, Makefile, etc.), run it with run_command when that is the fastest way to prove the change.
3. Fix every error you introduced. Prefer the smallest correct fix.
4. Re-run diagnostics (and the same test command if you used one).
5. Repeat until clean, or after ${maxRounds} fix rounds — then stop, summarize remaining failures, and ask the user.
Do not claim success while diagnostics or the chosen test command still fail. Do not loop forever.`;
}
