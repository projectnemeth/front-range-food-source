// Hosted UI integration. The original Apps Script deployment keeps its existing transport.
export const offlineShell = String.raw`
      let pendingCheckins = [], pendingStorageError = '';
      function pendingCheckin(id) { return pendingCheckins.find(e => e.method === 'requestAction' && e.request.id === id); }
      const outbox = FrfsOutbox.create({
        send: (method, request) => rawPickupApi(method, request),
        changed(state) { pendingCheckins = state.entries; pendingStorageError = state.storageError; renderOutbox(state.owner); },
        delivered(entry, result) { watchPrint(result.job, entry.name); if (!busy) quietRefresh(); },
      });
      function renderOutbox(owner) {
        let box = $('outbox');
        if (!box) {
          box = el('section', undefined, 'notice'); box.id = 'outbox'; box.setAttribute('aria-live','polite');
          $('staffApp').prepend(box);
        }
        box.replaceChildren(); box.hidden = !pendingCheckins.length && !pendingStorageError;
        if (pendingStorageError) box.append(el('p', pendingStorageError, 'error'));
        if (!pendingCheckins.length) return;
        box.append(el('strong', pendingCheckins.length + ' check-in(s) saved on this iPad—waiting to sync'));
        box.append(el('p', 'These are not confirmed at the packing station. Labels cannot print while this iPad is disconnected. Keep this app open; do not clear browser data.'));
        for (const entry of pendingCheckins) {
          const row = el('div');
          row.append(el('p', entry.name + ' · ' + entry.eventLabel + ' · #' + entry.request.arrival.number + ' · ' + entry.request.arrival.line + ' line'));
          if (entry.owner !== owner) row.append(el('p','Different iPad authorization. Ask a coordinator to reconcile this saved request.'));
          else if (entry.state === 'review') {
            row.append(el('p',entry.error));
            const retry = el('button', 'Review & retry ' + entry.name);
            retry.onclick = async () => {
              try {
                let review = {}, details = entry.name;
                if (entry.method === 'requestAction') {
                  const latest = await rawPickupApi('listRegistrations', entry.eventId);
                  const household = latest.find(r => r.id === entry.request.id);
                  if (!household) throw new Error('This registration is no longer available. Ask a coordinator to reconcile the saved check-in.');
                  if (!household.checkedInAt && (household.reviewRequired || (entry.request.action === 'checkin' && household.errors.length)))
                    throw new Error('A coordinator must resolve the current registration issues before this check-in can be retried.');
                  review.revision = household.revision;
                  details = household.name + ' · ' + household.phone + ' · ' + household.householdSize + ' people';
                }
                if (!confirm('Review current registration: ' + details + '. Pickup: ' + entry.eventLabel + ', car #' + entry.request.arrival.number + ', ' + entry.request.arrival.line + ' line. Confirm these details and that the household still needs check-in. Ask packing staff about any existing label. Retry the saved request?')) return;
                await outbox.retry(entry.token, review); await quietRefresh();
              } catch (e) {note(e.message,true);}
            };
            row.append(retry);
          } else row.append(el('p',entry.error || 'Waiting for a server confirmation.'));
          box.append(row);
        }
      }
      async function api(method, ...args) {
        if (method === 'addWalkIn' || (method === 'requestAction' && ['checkin','checkinOnly'].includes(args[0].action))) {
          const request = args[0], event = settings.events.find(e => e.id === $('event').value);
          return outbox.submit(method, request, {eventId: request.eventId || event.id, eventLabel:event.label, name:method==='addWalkIn' ? request.name : records.find(r=>r.id===request.id)?.name || 'Household'});
        }
        const value = await rawPickupApi(method, ...args);
        if (method === 'getStation') await outbox.bind(value.actor);
        return value;
      }
      async function reconnectCheckins() {
        if (!settings || document.hidden || navigator.onLine === false) return;
        try { await outbox.flush(); } catch (e) { note(e.message, true); }
      }
      window.addEventListener('online', reconnectCheckins);
      document.addEventListener('visibilitychange', reconnectCheckins);
      setInterval(reconnectCheckins, 15000);
`;
