// Versión del backend; debe coincidir con CFG.VERSION del frontend en cada entrega.
export const APP = 'ARKAPHOTO';
export const VERSION = '0.4.0';
export const MIGRACION_ESPERADA = 5;
export function conVersion(res){ res.setHeader('x-app-version', VERSION); return res; }
