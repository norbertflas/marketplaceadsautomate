/**
 * CPC Scheduler – background scheduler that fires chrome.alarms every minute
 * and executes scheduled actions on active Allegro Ads tabs.
 */

const ALARM_NAME = 'allegro-ads-scheduler';

export async function registerAlarms() {
  // Clear existing alarms
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.clear('allegro-ads-license-check');

  const { schedules } = await chrome.storage.local.get('schedules');
  const active = (schedules || []).filter(s => s.enabled);

  if (active.length > 0) {
    // Fire every minute for active schedules
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: 1,
      when: Date.now() + 5000, // start in 5 seconds
    });
  }

  // License check every 24 hours
  chrome.alarms.create('allegro-ads-license-check', {
    periodInMinutes: 60 * 24,
    when: Date.now() + 60000,
  });
}

export async function executeSchedule() {
  const { schedules, license } = await chrome.storage.local.get(['schedules', 'license']);
  if (!license?.valid) return;

  const activeSchedules = (schedules || []).filter(s => s.enabled);
  if (!activeSchedules.length) return;

  const now = new Date();
  const currentDay = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const toExecute = activeSchedules.filter(schedule => {
    return (
      schedule.days.includes(currentDay) &&
      schedule.hour === currentHour &&
      schedule.minute === currentMinute
    );
  });

  if (!toExecute.length) return;

  // Find active Allegro Ads tab
  const tabs = await chrome.tabs.query({
    url: 'https://salescenter.allegro.com/*',
    active: false, // find any tab, not just active
  });

  if (!tabs.length) {
    // Log failure – no browser tab available
    for (const schedule of toExecute) {
      await logScheduleExecution(schedule, {
        success: false,
        error: 'No Allegro Ads tab open. Open salescenter.allegro.com to enable scheduling.',
        timestamp: now.toISOString(),
      });
    }
    // Send notification
    await sendNotification(
      'Harmonogram nie wykonał się',
      'Otwórz salescenter.allegro.com żeby harmonogram mógł działać.'
    );
    return;
  }

  const tab = tabs[0];

  for (const schedule of toExecute) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXECUTE_SCHEDULE',
        schedule,
      });

      await logScheduleExecution(schedule, {
        success: result?.success ?? false,
        error: result?.error,
        affectedCampaigns: result?.affectedCampaigns,
        timestamp: now.toISOString(),
      });

      if (result?.success) {
        const { settings } = await chrome.storage.local.get('settings');
        if (settings?.notifications) {
          await sendNotification(
            `Harmonogram: ${schedule.name}`,
            `Wykonano dla ${result.affectedCampaigns ?? '?'} kampanii. CPC ${schedule.action.type} ${schedule.action.value}%`
          );
        }
      }
    } catch (err) {
      await logScheduleExecution(schedule, {
        success: false,
        error: err.message,
        timestamp: now.toISOString(),
      });
    }
  }
}

async function logScheduleExecution(schedule, result) {
  const { changeHistory } = await chrome.storage.local.get('changeHistory');
  const history = changeHistory || [];

  history.unshift({
    id: `sch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'schedule',
    scheduleName: schedule.name,
    scheduleId: schedule.id,
    action: schedule.action,
    ...result,
  });

  if (history.length > 1000) history.splice(1000);
  await chrome.storage.local.set({ changeHistory: history });
}

async function sendNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title,
      message,
    });
  } catch {
    // Notifications might not be available in all contexts
  }
}

/**
 * Build a human-readable description of a schedule
 */
export function describeSchedule(schedule) {
  const dayNames = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
  const days = schedule.days.map(d => dayNames[d]).join(', ');
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
  const actionLabel = schedule.action.type === 'increase' ? '+' : '-';
  return `${days} o ${time} → CPC ${actionLabel}${schedule.action.value}%`;
}
