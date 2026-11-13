import type { Config, Context } from '@netlify/functions';
import { executeDailyNotificationMonitoring } from '../../backend/notificationEngine';

export const config: Config = {
  schedule: '0 8 * * *', // Executa diariamente às 08:00 UTC (05:00 BRT)
};

export default async (_req: Request, _context: Context) => {
  console.log('[Netlify Scheduled] Iniciando execução diária de executeDailyNotificationMonitoring()...');
  try {
    const result = await executeDailyNotificationMonitoring();
    return new Response(
      JSON.stringify({
        success: true,
        dispatched: result.dispatched,
        skippedDuplicates: result.skippedDuplicates,
        unmatched: result.unmatched,
        totalEvaluated: result.totalEvaluated,
        timestamp: result.timestamp,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err: any) {
    console.error('[Netlify Scheduled Error]:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err?.message || 'Erro durante execução agendada de notificações.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
