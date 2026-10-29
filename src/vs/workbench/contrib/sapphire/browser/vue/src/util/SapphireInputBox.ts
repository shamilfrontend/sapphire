/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type TextAreaFns = {
  setValue: (v: string) => void;
  enable: () => void;
  disable: () => void;
};

export type TextAreaFnsRef = { current: null | TextAreaFns };
