export const state = {
  company: null,
  settings: {},
  agents: [],
  engines: [],
  projects: [],
  tasks: [],
  reports: [],
  meetings: [],
  activity: [],
  stats: null,
  departments: [],
  workspaceRoot: '',
  loaded: false,
  connection: 'connecting',
  lastEventAt: null,
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const options = { method, headers: {}, signal };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = (data && data.error) || (typeof data === 'string' && data) || `Permintaan gagal (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return data;
}

export async function loadBootstrap() {
  const data = await api('/api/bootstrap');
  state.company = data.company;
  state.settings = data.settings || {};
  state.agents = data.agents || [];
  state.engines = data.engines || [];
  state.projects = data.projects || [];
  state.tasks = data.tasks || [];
  state.reports = data.reports || [];
  state.meetings = data.meetings || [];
  state.activity = data.activity || [];
  state.stats = data.stats;
  state.departments = data.departments || [];
  state.workspaceRoot = data.workspace_root;
  state.loaded = true;
  return data;
}

export function applyEvent(event) {
  const { type, payload } = event;
  state.lastEventAt = event.at;
  let changed = true;
  if (type === 'agent.new' || type === 'agent.update') {
    const index = state.agents.findIndex((agent) => agent.id === payload.id);
    if (index >= 0) state.agents[index] = { ...state.agents[index], ...payload };
    else state.agents.push(payload);
    if (payload.active === 0) {
      // keep in list but inactive; views filter as needed
    }
  } else if (type === 'engine.update') {
    const index = state.engines.findIndex((engine) => engine.id === payload.id);
    if (index >= 0) state.engines[index] = { ...state.engines[index], ...payload };
    else state.engines.push(payload);
  } else if (type === 'task.new' || type === 'task.update') {
    const index = state.tasks.findIndex((task) => task.id === payload.id);
    if (index >= 0) state.tasks[index] = { ...state.tasks[index], ...payload };
    else state.tasks.unshift(payload);
  } else if (type === 'project.update') {
    const index = state.projects.findIndex((project) => project.id === payload.id);
    if (index >= 0) state.projects[index] = { ...state.projects[index], ...payload };
    else state.projects.unshift(payload);
  } else if (type === 'report.new') {
    if (!state.reports.find((report) => report.id === payload.id)) state.reports.unshift(payload);
  } else if (type === 'meeting.new') {
    changed = true;
  } else if (type === 'activity') {
    state.activity.unshift({
      id: `live-${Date.now()}-${Math.random()}`,
      message: payload.message,
      actor_name: '',
      created_at: event.at || new Date().toISOString(),
    });
    if (state.activity.length > 80) state.activity.length = 80;
  } else if (type === 'company.update') {
    state.company = payload;
  } else if (type === 'settings.update') {
    state.settings = payload;
  } else if (type === 'data.restored') {
    window.location.reload();
    return { type, payload, changed: false };
  } else {
    changed = false;
  }
  return { type, payload, changed };
}

export function connectEvents(handler) {
  let source;
  const start = () => {
    source = new EventSource('/api/events');
    source.onopen = () => {
      state.connection = 'online';
      handler({ type: 'connection', payload: { status: 'online' } });
    };
    source.onerror = () => {
      state.connection = 'offline';
      handler({ type: 'connection', payload: { status: 'offline' } });
    };
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.type === 'connected') return;
        const result = applyEvent(event);
        handler({ ...result, raw: event });
      } catch { /* ignore malformed */ }
    };
  };
  start();
  window.addEventListener('beforeunload', () => source?.close());
  return { close: () => source?.close() };
}

export function agentById(id) {
  return state.agents.find((agent) => agent.id === id) || null;
}

export function engineById(id) {
  return state.engines.find((engine) => engine.id === id) || null;
}

export function isEngineConnected(engine) {
  return Boolean(engine && (engine.type === 'simulation' || engine.connected || engine.status === 'Terhubung'));
}

export function connectedEngines() {
  return state.engines.filter((engine) => engine.type !== 'simulation' && isEngineConnected(engine));
}

export function realEngines() {
  return state.engines.filter((engine) => engine.type !== 'simulation');
}

export function projectById(id) {
  return state.projects.find((project) => project.id === id) || null;
}

export function activeTasksForAgent(agentId) {
  return state.tasks.filter((task) => task.assignee_id === agentId
    && ['Menunggu', 'Direncanakan', 'Sedang dikerjakan', 'Dalam pemeriksaan'].includes(task.status)).length;
}

export function refreshBootstrap() {
  return loadBootstrap();
}
