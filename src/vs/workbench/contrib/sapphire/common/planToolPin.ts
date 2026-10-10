/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMessage, ToolMessage } from './chatThreadServiceTypes.js';

export type ActivePlanPinState = {
  planUriFsPath: string;
  name: string;
  status: 'ready' | 'building' | 'built';
  progressLabel?: string;
};

export type PlanToolSuccessMessage =
  | ToolMessage<'create_plan'>
  | ToolMessage<'update_plan'>;

/** fsPath плана из success create_plan/update_plan (result или params). */
export const planUriFsPathFromPlanTool = (m: PlanToolSuccessMessage): string | null => {
  if (m.type === 'success' && m.result && 'planUri' in m.result && m.result.planUri) {
    return m.result.planUri.fsPath;
  }
  if (
    m.type !== 'invalid_params' &&
    'params' in m &&
    m.params &&
    'planUri' in m.params &&
    m.params.planUri
  ) {
    return m.params.planUri.fsPath;
  }
  return null;
};

/**
 * URI плана для схлопывания create_plan/update_plan в ленте.
 * Нужен при ready (пин над композером) и при building/built (пин скрыт, полную карточку не разворачивать).
 */
export const planUriFsPathToCollapseInThread = (
  activePlan: ActivePlanPinState | undefined,
): string | null => {
  if (!activePlan) {
    return null;
  }
  if (
    activePlan.status !== 'ready' &&
    activePlan.status !== 'building' &&
    activePlan.status !== 'built'
  ) {
    return null;
  }
  return activePlan.planUriFsPath;
};

/**
 * Сообщение для закреплённой карточки «План создан» над композером.
 * Только status === 'ready' — при building/built прогресс и повторный запуск в редакторе плана.
 * Предпочитает успешный create_plan того же URI, что activePlan; иначе — update_plan.
 */
export const findPinnedPlanToolMessage = (
  messages: ChatMessage[],
  activePlan: ActivePlanPinState | undefined,
): PlanToolSuccessMessage | null => {
  if (!activePlan || activePlan.status !== 'ready') {
    return null;
  }

  let lastCreate: PlanToolSuccessMessage | null = null;
  let lastAny: PlanToolSuccessMessage | null = null;

  for (const m of messages) {
    if (m.role !== 'tool' || m.type !== 'success') {
      continue;
    }
    if (m.name !== 'create_plan' && m.name !== 'update_plan') {
      continue;
    }
    const planMsg = m as PlanToolSuccessMessage;
    const uri = planUriFsPathFromPlanTool(planMsg);
    if (uri !== activePlan.planUriFsPath) {
      continue;
    }
    lastAny = planMsg;
    if (m.name === 'create_plan') {
      lastCreate = planMsg;
    }
  }

  return lastCreate ?? lastAny;
};

/** В ленте не дублировать полную карточку того же плана (пин или building/built). */
export const shouldCollapsePlanToolInThread = (
  toolMessage: ChatMessage & { role: 'tool' },
  collapsePlanUriFsPath: string | null | undefined,
): boolean => {
  if (!collapsePlanUriFsPath) {
    return false;
  }
  if (toolMessage.type !== 'success') {
    return false;
  }
  if (toolMessage.name !== 'create_plan' && toolMessage.name !== 'update_plan') {
    return false;
  }
  const uri = planUriFsPathFromPlanTool(toolMessage as PlanToolSuccessMessage);
  return uri === collapsePlanUriFsPath;
};
