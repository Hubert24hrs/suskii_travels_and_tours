// Installs the error handlers before Expo Router starts the app (imported second by index.ts).
import { installErrorReporting } from './lib/error-reporting';

installErrorReporting();
