'use client';

import { useTranslator } from '@suskii/i18n/react';

import type { CarsMessages } from './cars-messages';

export const useCarsT = () => useTranslator<CarsMessages>();
