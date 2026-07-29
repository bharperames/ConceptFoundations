import { uuid } from './core.js';
import { Store } from './store.js';

const Telemetry = {
  session: null,
  begin(node, level, seed){
    this.session = {
      id: uuid(), userId:'child-local', node: node.key, nodeTitle: node.parentName,
      levelId: level.id, levelName: level.name, isGen: !!level.isGen, seed,
      startTime: Date.now(), endTime: null, trials: [], events: [],
    };
  },
  addTrial(t){ if (this.session) this.session.trials.push(t); },
  event(e){ if (this.session) this.session.events.push({ eventId: uuid(), ...e }); },
  end(completed, outcome){
    if (!this.session) return null;
    this.session.endTime = Date.now();
    this.session.completed = completed;
    if (outcome) this.session.outcome = outcome;
    const s = Store.sessions(); s.push(this.session); Store.saveSessions(s);
    const done = this.session; this.session = null; return done;
  },
};

/* Shared DDA rule (curriculum implementation note): the live engine and the
   simulation harness both route run results through this exact function. */

export { Telemetry };
