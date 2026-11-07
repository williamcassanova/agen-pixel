const W = 1000;
const H = 640;
const TILE = 20;

const ROOMS = [
  { key: 'ceo', name: 'Ruang CEO', x: 20, y: 20, w: 220, h: 150, accent: '#f5b942', doors: [{ x: 130, y: 170, cy: 180 }] },
  { key: 'secretary', name: 'Meja Sekretaris', x: 260, y: 20, w: 190, h: 150, accent: '#a78bfa', dept: 'Operasional', doors: [{ x: 355, y: 170, cy: 180 }] },
  { key: 'meeting', name: 'Ruang Rapat', x: 470, y: 20, w: 510, h: 150, accent: '#4cc9f0', doors: [{ x: 725, y: 170, cy: 180 }] },
  { key: 'development', name: 'Ruang Programmer', x: 20, y: 190, w: 260, h: 210, accent: '#3b82f6', dept: 'Development', doors: [{ x: 150, y: 190, cy: 180 }, { x: 150, y: 400, cy: 410 }] },
  { key: 'research', name: 'Ruang Penelitian', x: 300, y: 190, w: 260, h: 210, accent: '#10b981', dept: 'Research', doors: [{ x: 430, y: 190, cy: 180 }, { x: 430, y: 400, cy: 410 }] },
  { key: 'design', name: 'Ruang Desain', x: 580, y: 190, w: 400, h: 210, accent: '#ec4899', dept: 'Design', doors: [{ x: 780, y: 190, cy: 180 }, { x: 780, y: 400, cy: 410 }] },
  { key: 'qa', name: 'Ruang Pengujian', x: 20, y: 420, w: 300, h: 200, accent: '#f59e0b', dept: 'Quality Assurance', doors: [{ x: 170, y: 420, cy: 410 }] },
  { key: 'marketing', name: 'Ruang Marketing', x: 340, y: 420, w: 300, h: 200, accent: '#ef4444', dept: 'Marketing', doors: [{ x: 490, y: 420, cy: 410 }] },
  { key: 'break', name: 'Area Istirahat', x: 660, y: 420, w: 320, h: 200, accent: '#22d3ee', doors: [{ x: 820, y: 420, cy: 410 }] },
];

const ROOM_BY_KEY = Object.fromEntries(ROOMS.map((room) => [room.key, room]));
const DEPT_ROOM = {
  Development: 'development',
  Research: 'research',
  Design: 'design',
  'Quality Assurance': 'qa',
  Marketing: 'marketing',
  Operasional: 'secretary',
};

const SHIRTS = ['#4cc9f0', '#f5b942', '#3ddc97', '#f472b6', '#a78bfa', '#fb923c', '#60a5fa', '#f87171', '#34d399', '#e879f9'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#a9714b', '#ffdbac'];
const HAIRS = ['#2b1b12', '#4a2c1a', '#111111', '#6b4423', '#c9a227', '#7a2e1d'];

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < String(text).length; i += 1) {
    hash = ((hash << 5) - hash + String(text).charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function roomPoint(room, fx, fy) {
  return { x: room.x + room.w * fx, y: room.y + room.h * fy };
}

function seatSlots(roomKey, count) {
  const room = ROOM_BY_KEY[roomKey];
  if (!room) return [];
  if (roomKey === 'meeting') {
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2 + 6;
    const slots = [];
    for (let i = 0; i < 4; i += 1) slots.push({ x: cx - 108 + i * 72, y: cy - 32, face: 'down' });
    for (let i = 0; i < 4; i += 1) slots.push({ x: cx - 108 + i * 72, y: cy + 44, face: 'up' });
    return slots;
  }
  if (roomKey === 'ceo') return [{ x: room.x + 110, y: room.y + 92 }];
  if (roomKey === 'secretary') {
    return [
      { x: room.x + 62, y: room.y + 82 },
      { x: room.x + 132, y: room.y + 82 },
    ];
  }
  if (roomKey === 'break') return [];
  const cols = room.w >= 380 ? 3 : 2;
  const rows = Math.max(1, Math.ceil(count / cols));
  const slots = [];
  const marginX = 56;
  const stepX = cols === 1 ? 0 : (room.w - marginX * 2) / (cols - 1);
  const stepY = Math.min(64, (room.h - 84) / Math.max(1, rows));
  for (let i = 0; i < Math.max(count, cols); i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    slots.push({ x: room.x + marginX + col * stepX, y: room.y + 58 + row * stepY });
  }
  return slots;
}

function targetSeat(agent, index, meetingIndex, deptCount = 4) {
  const isMeeting = agent.status === 'Rapat';
  const roomKey = isMeeting ? 'meeting' : (DEPT_ROOM[agent.department] || 'secretary');
  const slots = seatSlots(roomKey, roomKey === 'secretary' ? 2 : Math.max(4, deptCount));
  let slot;
  if (isMeeting) slot = slots[meetingIndex % slots.length] || slots[0];
  else slot = slots[index % slots.length] || roomPoint(ROOM_BY_KEY[roomKey], 0.5, 0.6);
  return { roomKey, x: slot.x, y: slot.y, isMeeting };
}

function corridorRoute(startRoomKey, targetRoomKey, startPos, targetPos) {
  if (startRoomKey === targetRoomKey) {
    return [{ x: targetPos.x, y: targetPos.y }];
  }
  const startRoom = ROOM_BY_KEY[startRoomKey];
  const targetRoom = ROOM_BY_KEY[targetRoomKey];
  if (!startRoom || !targetRoom) return [{ x: targetPos.x, y: targetPos.y }];
  const startDoor = startRoom.doors
    .map((door) => ({ door, d: Math.abs(door.x - startPos.x) + Math.abs(door.y - startPos.y) }))
    .sort((a, b) => a.d - b.d)[0].door;
  let best = null;
  for (const targetDoor of targetRoom.doors) {
    const sy = startDoor.cy;
    const ty = targetDoor.cy;
    const points = [{ x: startDoor.x, y: startDoor.y }, { x: startDoor.x, y: sy }];
    if (sy === ty) {
      points.push({ x: targetDoor.x, y: sy });
      points.push({ x: targetDoor.x, y: sy + (targetDoor.y - ty) });
    } else {
      const connectors = [290, 570];
      let bestConnector = connectors[0];
      let bestCost = Infinity;
      for (const c of connectors) {
        const cost = Math.abs(startDoor.x - c) + Math.abs(targetDoor.x - c);
        if (cost < bestCost) { bestCost = cost; bestConnector = c; }
      }
      points.push({ x: bestConnector, y: sy });
      points.push({ x: bestConnector, y: ty });
      points.push({ x: targetDoor.x, y: ty });
    }
    points.push({ x: targetDoor.x, y: targetDoor.y });
    points.push({ x: targetPos.x, y: targetPos.y });
    const cost = Math.abs(startPos.x - targetPos.x) + Math.abs(startPos.y - targetPos.y)
      + Math.abs(startDoor.x - targetDoor.x);
    if (!best || cost < best.cost) best = { cost, points };
  }
  return best.points;
}

export class OfficeRenderer {
  constructor(canvas, { onSelect } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.active = false;
    this.raf = null;
    this.lastFrame = 0;
    this.accumulator = 0;
    this.time = 0;
    this.agents = [];
    this.company = null;
    this.characters = new Map();
    this.hoveredId = null;
    this.selectedId = null;
    this.ceo = { id: 'ceo', x: ROOM_BY_KEY.ceo.x + 110, y: ROOM_BY_KEY.ceo.y + 92, moving: false, state: 'idle', face: 'down', phase: 0, typing: 0 };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement || canvas);
    canvas.addEventListener('click', this.onCanvasClick = (event) => this.handleClick(event));
    canvas.addEventListener('mousemove', this.onCanvasMove = (event) => this.handleMove(event));
    canvas.addEventListener('mouseleave', () => { this.hoveredId = null; this.canvas.style.cursor = 'default'; });
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, rect.width);
    const height = Math.max(200, rect.height);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.scaleX = (width * dpr) / W;
    this.scaleY = (height * dpr) / H;
    this.dpr = dpr;
    this.cssWidth = width;
    this.cssHeight = height;
    this.draw();
  }

  setActive(active) {
    this.active = active;
    if (active && !this.raf) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame((time) => this.loop(time));
    } else if (!active && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  setData({ agents, company, tasks }) {
    this.agents = (agents || []).filter((agent) => agent.active !== false && agent.status !== 'Nonaktif');
    this.company = company;
    this.tasks = tasks || [];
    const meetingAgents = this.agents.filter((agent) => agent.status === 'Rapat').sort((a, b) => a.id.localeCompare(b.id));
    const now = performance.now();
    const seen = new Set();
    for (const agent of this.agents) {
      seen.add(agent.id);
      const deptAgents = this.agents.filter((item) => item.department === agent.department).sort((a, b) => a.id.localeCompare(b.id));
      const index = Math.max(0, deptAgents.findIndex((item) => item.id === agent.id));
      const meetingIndex = Math.max(0, meetingAgents.findIndex((item) => item.id === agent.id));
      const target = targetSeat(agent, index, meetingIndex, deptAgents.length);
      let character = this.characters.get(agent.id);
      if (!character) {
        character = {
          id: agent.id,
          x: target.x,
          y: target.y,
          roomKey: target.roomKey,
          targetRoomKey: target.roomKey,
          targetX: target.x,
          targetY: target.y,
          path: [],
          moving: false,
          state: agent.status === 'Rapat' ? 'meeting' : agent.status === 'Bekerja' ? 'working' : 'idle',
          face: 'down',
          phase: hashString(agent.id) % 10,
          typing: 0,
          updatedAt: now,
        };
        this.characters.set(agent.id, character);
      }
      const moved = Math.abs(character.targetX - target.x) > 1 || Math.abs(character.targetY - target.y) > 1
        || character.targetRoomKey !== target.roomKey;
      if (moved) {
        character.path = corridorRoute(character.roomKey, target.roomKey,
          { x: character.x, y: character.y }, { x: target.x, y: target.y });
        character.targetRoomKey = target.roomKey;
        character.targetX = target.x;
        character.targetY = target.y;
      }
      const nextState = agent.status === 'Rapat' ? 'meeting' : agent.status === 'Bekerja' ? 'working' : 'idle';
      if (character.state !== nextState && character.path.length === 0) character.state = nextState;
      character.pendingState = nextState;
      character.agent = agent;
    }
    for (const id of [...this.characters.keys()]) {
      if (!seen.has(id)) this.characters.delete(id);
    }
    this.agentsById = new Map(this.agents.map((agent) => [agent.id, agent]));
  }

  loop(time) {
    if (!this.active) { this.raf = null; return; }
    this.raf = requestAnimationFrame((next) => this.loop(next));
    const delta = Math.min(120, time - this.lastFrame);
    this.lastFrame = time;
    this.accumulator += delta;
    if (this.accumulator < 1000 / 12) return;
    const dt = this.accumulator / 1000;
    this.accumulator = 0;
    this.time = time;
    this.update(dt);
    this.draw();
  }

  update(dt) {
    for (const character of this.characters.values()) {
      if (character.path && character.path.length) {
        const next = character.path[0];
        const dx = next.x - character.x;
        const dy = next.y - character.y;
        const distance = Math.hypot(dx, dy);
        const speed = 52;
        if (distance <= speed * dt) {
          character.x = next.x;
          character.y = next.y;
          character.path.shift();
        } else {
          character.x += (dx / distance) * speed * dt;
          character.y += (dy / distance) * speed * dt;
          if (Math.abs(dx) > Math.abs(dy)) character.face = dx > 0 ? 'right' : 'left';
          else character.face = dy > 0 ? 'down' : 'up';
        }
        character.moving = true;
        character.phase += dt * 8;
        if (character.path.length === 0) {
          character.roomKey = character.targetRoomKey;
          character.state = character.pendingState || character.state;
        }
      } else {
        character.moving = false;
        character.roomKey = character.targetRoomKey;
        character.state = character.pendingState || character.state;
        if (character.state === 'working') character.typing += dt * 6;
        character.phase += dt * 1.6;
      }
    }
    if (this.company) {
      this.ceo.phase += dt * 1.4;
    }
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.scaleX) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#080d16';
    ctx.fillRect(0, 0, W, H);
    this.drawCorridors(ctx);
    for (const room of ROOMS) this.drawRoom(ctx, room);
    this.drawDoorways(ctx);
    this.drawFurniture(ctx);
    this.drawMeetingTable(ctx);
    const drawList = [...this.characters.values()].map((character) => ({ type: 'agent', character }));
    drawList.push({ type: 'ceo', character: this.ceo });
    drawList.sort((a, b) => a.character.y - b.character.y);
    for (const item of drawList) {
      if (item.type === 'ceo') this.drawCeo(ctx, item.character);
      else this.drawAgent(ctx, item.character);
    }
    this.drawSelection(ctx);
    this.drawLabels(ctx);
  }

  drawCorridors(ctx) {
    ctx.fillStyle = '#111a2b';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#172338';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += TILE) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += TILE) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(245,185,66,0.05)';
    ctx.fillRect(0, 173, W, 14);
    ctx.fillRect(0, 403, W, 14);
  }

  drawRoom(ctx, room) {
    ctx.fillStyle = '#0f1a2c';
    ctx.fillRect(room.x - 4, room.y - 4, room.w + 8, room.h + 8);
    ctx.fillStyle = '#0c1523';
    ctx.fillRect(room.x, room.y, room.w, room.h);
    const tint = room.accent;
    ctx.fillStyle = this.hexAlpha(tint, 0.07);
    ctx.fillRect(room.x, room.y, room.w, room.h);
    ctx.strokeStyle = this.hexAlpha(tint, 0.08);
    ctx.lineWidth = 1;
    for (let x = room.x + TILE; x < room.x + room.w; x += TILE) {
      ctx.beginPath(); ctx.moveTo(x, room.y); ctx.lineTo(x, room.y + room.h); ctx.stroke();
    }
    for (let y = room.y + TILE; y < room.y + room.h; y += TILE) {
      ctx.beginPath(); ctx.moveTo(room.x, y); ctx.lineTo(room.x + room.w, y); ctx.stroke();
    }
    ctx.strokeStyle = '#2a3c5c';
    ctx.lineWidth = 4;
    ctx.strokeRect(room.x + 2, room.y + 2, room.w - 4, room.h - 4);
    ctx.fillStyle = this.hexAlpha(tint, 0.85);
    ctx.fillRect(room.x + 2, room.y + 2, room.w - 4, 15);
    ctx.fillStyle = '#07101d';
    ctx.fillRect(room.x + 8, room.y + 5, 4, 9);
    ctx.fillStyle = '#e9f2ff';
    ctx.font = '700 10px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(room.name.toUpperCase(), room.x + 17, room.y + 10);
    ctx.fillStyle = this.hexAlpha(tint, 0.16);
    ctx.fillRect(room.x + 4, room.y + 19, room.w - 8, 2);
  }

  drawDoorways(ctx) {
    for (const room of ROOMS) {
      for (const door of room.doors) {
        const vertical = Math.abs(door.y - (room.y + room.h)) < 1 || Math.abs(door.y - room.y) < 1;
        ctx.fillStyle = '#0d1726';
        if (vertical) ctx.fillRect(door.x - 10, door.y - 5, 20, 10);
        else ctx.fillRect(door.x - 5, door.y - 10, 10, 20);
        ctx.fillStyle = this.hexAlpha(room.accent, 0.7);
        if (vertical) ctx.fillRect(door.x - 8, door.y - 1, 16, 2);
        else ctx.fillRect(door.x - 1, door.y - 8, 2, 16);
      }
    }
  }

  drawFurniture(ctx) {
    const ceo = ROOM_BY_KEY.ceo;
    this.drawRug(ctx, ceo.x + 42, ceo.y + 58, 136, 60, '#7a5511');
    this.drawDesk(ctx, ceo.x + 110, ceo.y + 92, '#b9821f');
    this.drawMonitor(ctx, ceo.x + 110, ceo.y + 96, '#ffd166');
    this.drawBookshelf(ctx, ceo.x + 10, ceo.y + 28);
    this.drawPlant(ctx, ceo.x + 190, ceo.y + 128);

    const sec = ROOM_BY_KEY.secretary;
    this.drawDesk(ctx, sec.x + 62, sec.y + 82, '#8b5cf6');
    this.drawMonitor(ctx, sec.x + 62, sec.y + 86, '#c4b5fd');
    this.drawDesk(ctx, sec.x + 132, sec.y + 82, '#8b5cf6');
    this.drawMonitor(ctx, sec.x + 132, sec.y + 86, '#c4b5fd');
    this.drawCoffee(ctx, sec.x + 12, sec.y + 30);
    this.drawPlant(ctx, sec.x + 168, sec.y + 128);

    const meeting = ROOM_BY_KEY.meeting;
    this.drawWhiteboard(ctx, meeting.x + 8, meeting.y + 20, 100, 96, '#4cc9f0');
    this.drawPlant(ctx, meeting.x + 478, meeting.y + 124);
    this.drawPlant(ctx, meeting.x + 18, meeting.y + 124);

    this.drawDeptRoom(ctx, ROOM_BY_KEY.development, '#3b82f6', 'server');
    this.drawDeptRoom(ctx, ROOM_BY_KEY.research, '#10b981', 'lab');
    this.drawDeptRoom(ctx, ROOM_BY_KEY.design, '#ec4899', 'mood');
    this.drawDeptRoom(ctx, ROOM_BY_KEY.qa, '#f59e0b', 'bug');
    this.drawDeptRoom(ctx, ROOM_BY_KEY.marketing, '#ef4444', 'chart');

    const rest = ROOM_BY_KEY.break;
    this.drawRug(ctx, rest.x + 70, rest.y + 80, 180, 80, '#0e4a53');
    this.drawSofa(ctx, rest.x + 40, rest.y + 120);
    this.drawCoffee(ctx, rest.x + 255, rest.y + 30);
    this.drawFridge(ctx, rest.x + 280, rest.y + 84);
    this.drawPlant(ctx, rest.x + 18, rest.y + 168);
    this.drawPlant(ctx, rest.x + 292, rest.y + 168);
    this.drawTableSmall(ctx, rest.x + 150, rest.y + 52);
  }

  drawDeptRoom(ctx, room, color, variant) {
    const count = this.agents.filter((agent) => agent.department === room.dept).length;
    const slots = seatSlots(room.key, Math.max(4, count));
    slots.forEach((slot) => {
      this.drawDesk(ctx, slot.x, slot.y, color);
      this.drawMonitor(ctx, slot.x, slot.y + 4, color);
    });
    if (variant === 'server') {
      this.drawServerRack(ctx, room.x + room.w - 30, room.y + 34);
      this.drawWhiteboard(ctx, room.x + room.w / 2 - 50, room.y + 26, 100, 34, color);
    } else if (variant === 'lab') {
      this.drawBookshelf(ctx, room.x + room.w / 2 - 22, room.y + 28);
      this.drawLabBench(ctx, room.x + room.w - 78, room.y + room.h - 30);
    } else if (variant === 'mood') {
      this.drawMoodboard(ctx, room.x + room.w - 156, room.y + room.h - 68);
      this.drawPlant(ctx, room.x + room.w - 26, room.y + room.h - 24);
    } else if (variant === 'bug') {
      this.drawWhiteboard(ctx, room.x + room.w / 2 - 60, room.y + 26, 120, 34, color);
      this.drawServerRack(ctx, room.x + room.w - 30, room.y + 34);
    } else if (variant === 'chart') {
      this.drawWhiteboard(ctx, room.x + room.w / 2 - 60, room.y + 26, 120, 42, color);
      this.drawPlant(ctx, room.x + room.w - 26, room.y + room.h - 24);
    }
  }

  drawMeetingTable(ctx) {
    const room = ROOM_BY_KEY.meeting;
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2 + 6;
    const w = 260;
    const h = 64;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(cx - w / 2 + 4, cy - h / 2 + 4, w, h);
    ctx.fillStyle = '#2b3a55';
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = '#3a4d6e';
    ctx.fillRect(cx - w / 2 + 4, cy - h / 2 + 4, w - 8, h - 8);
    ctx.fillStyle = '#4cc9f0';
    ctx.fillRect(cx - 24, cy - 10, 48, 20);
    ctx.fillStyle = '#16303d';
    ctx.fillRect(cx - 20, cy - 6, 40, 12);
    for (let i = 0; i < 4; i += 1) {
      this.drawChair(ctx, cx - 108 + i * 72, cy - 46, '#4cc9f0');
      this.drawChair(ctx, cx - 108 + i * 72, cy + 46, '#4cc9f0');
    }
  }

  drawDesk(ctx, x, y, accent) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x - 24, y + 5, 48, 20);
    ctx.fillStyle = '#3d2c1c';
    ctx.fillRect(x - 24, y + 3, 48, 18);
    ctx.fillStyle = '#5a4128';
    ctx.fillRect(x - 24, y + 3, 48, 5);
    ctx.fillStyle = accent;
    ctx.fillRect(x - 20, y + 17, 40, 2);
    ctx.fillStyle = '#231a10';
    ctx.fillRect(x - 20, y + 21, 4, 6);
    ctx.fillRect(x + 16, y + 21, 4, 6);
  }

  drawMonitor(ctx, x, y, accent) {
    ctx.fillStyle = '#0c1422';
    ctx.fillRect(x - 9, y + 1, 18, 12);
    ctx.fillStyle = this.hexAlpha(accent, 0.6);
    ctx.fillRect(x - 7, y + 3, 14, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x - 6, y + 4, 6, 1);
    ctx.fillRect(x - 6, y + 6, 9, 1);
    ctx.fillStyle = '#1a2436';
    ctx.fillRect(x - 2, y + 13, 4, 3);
  }

  drawPlant(ctx, x, y) {
    ctx.fillStyle = '#3b2a18';
    ctx.fillRect(x - 6, y + 6, 12, 9);
    ctx.fillStyle = '#1f7a4d';
    ctx.fillRect(x - 4, y - 6, 8, 12);
    ctx.fillStyle = '#2eb572';
    ctx.fillRect(x - 8, y - 2, 6, 8);
    ctx.fillRect(x + 2, y - 4, 6, 8);
    ctx.fillStyle = '#57d99b';
    ctx.fillRect(x - 2, y - 8, 4, 6);
  }

  drawBookshelf(ctx, x, y) {
    ctx.fillStyle = '#2a1c12';
    ctx.fillRect(x, y, 44, 14);
    const colors = ['#a78bfa', '#4cc9f0', '#f5b942', '#3ddc97', '#f472b6'];
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x + 3 + i * 6.5, y + 3, 4, 8);
    }
  }

  drawWhiteboard(ctx, x, y, w, h, color) {
    ctx.fillStyle = '#dbe7f8';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#52627c';
    ctx.fillRect(x + 8, y + 10, w - 40, 2);
    ctx.fillRect(x + 8, y + 18, w - 24, 2);
    ctx.fillStyle = color;
    ctx.fillRect(x + 8, y + 26, 16, 2);
  }

  drawServerRack(ctx, x, y) {
    ctx.fillStyle = '#0b1422';
    ctx.fillRect(x, y, 26, 52);
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = '#1d2c46';
      ctx.fillRect(x + 4, y + 5 + i * 11, 18, 8);
      ctx.fillStyle = i === 1 ? '#3ddc97' : '#4cc9f0';
      ctx.fillRect(x + 17, y + 7 + i * 11, 3, 3);
    }
  }

  drawLabBench(ctx, x, y) {
    ctx.fillStyle = '#233a44';
    ctx.fillRect(x, y, 62, 16);
    const flasks = ['#3ddc97', '#4cc9f0', '#f472b6'];
    for (let i = 0; i < 3; i += 1) {
      ctx.fillStyle = flasks[i];
      ctx.fillRect(x + 8 + i * 18, y + 4, 8, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(x + 9 + i * 18, y + 5, 2, 2);
    }
  }

  drawMoodboard(ctx, x, y) {
    ctx.fillStyle = '#1a1020';
    ctx.fillRect(x, y, 66, 46);
    const colors = ['#ec4899', '#f472b6', '#a78bfa', '#f5b942', '#4cc9f0', '#3ddc97'];
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = colors[i];
      ctx.fillRect(x + 6 + (i % 3) * 19, y + 6 + Math.floor(i / 3) * 19, 14, 14);
    }
  }

  drawSofa(ctx, x, y) {
    ctx.fillStyle = '#173a4a';
    ctx.fillRect(x, y, 70, 26);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(x + 4, y + 4, 28, 18);
    ctx.fillRect(x + 36, y + 4, 28, 18);
    ctx.fillStyle = '#0e2733';
    ctx.fillRect(x, y - 6, 70, 8);
  }

  drawCoffee(ctx, x, y) {
    ctx.fillStyle = '#223149';
    ctx.fillRect(x, y, 22, 26);
    ctx.fillStyle = '#4cc9f0';
    ctx.fillRect(x + 4, y + 3, 14, 6);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(x + 8, y + 13, 6, 6);
    ctx.fillStyle = '#0b1422';
    ctx.fillRect(x + 6, y + 22, 10, 3);
  }

  drawFridge(ctx, x, y) {
    ctx.fillStyle = '#c9d8ea';
    ctx.fillRect(x, y, 24, 40);
    ctx.fillStyle = '#8fa3c4';
    ctx.fillRect(x + 3, y + 3, 18, 15);
    ctx.fillRect(x + 3, y + 21, 18, 15);
    ctx.fillStyle = '#52627c';
    ctx.fillRect(x + 17, y + 8, 2, 6);
  }

  drawTableSmall(ctx, x, y) {
    ctx.fillStyle = '#3d2c1c';
    ctx.fillRect(x, y, 46, 20);
    ctx.fillStyle = '#5a4128';
    ctx.fillRect(x, y, 46, 4);
    ctx.fillStyle = '#c9d8ea';
    ctx.fillRect(x + 8, y + 8, 10, 7);
    ctx.fillRect(x + 26, y + 8, 10, 7);
  }

  drawChair(ctx, x, y, color) {
    ctx.fillStyle = '#16243a';
    ctx.fillRect(x - 6, y - 5, 12, 10);
    ctx.fillStyle = this.hexAlpha(color, 0.5);
    ctx.fillRect(x - 4, y - 3, 8, 6);
  }

  drawRug(ctx, x, y, w, h, color) {
    ctx.fillStyle = this.hexAlpha(color, 0.35);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = this.hexAlpha(color, 0.7);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  }

  drawAgent(ctx, character) {
    const agent = character.agent || this.agentsById?.get(character.id);
    if (!agent) return;
    const seed = hashString(agent.id);
    const shirt = SHIRTS[seed % SHIRTS.length];
    const skin = SKINS[(seed >> 2) % SKINS.length];
    const hair = HAIRS[(seed >> 4) % HAIRS.length];
    this.drawPerson(ctx, character, { shirt, skin, hair, seed, seated: character.state === 'working' || character.state === 'meeting' });
    if (this.hoveredId === agent.id || this.selectedId === agent.id) {
      this.drawNameTag(ctx, character, agent.name, agent.role);
    }
    this.drawStatusBubble(ctx, character, agent.status, seed);
  }

  drawCeo(ctx, character) {
    const company = this.company;
    const seed = 7;
    this.drawPerson(ctx, character, { shirt: '#f5b942', skin: '#e0ac69', hair: '#2b1b12', seed, seated: false, crown: true });
    this.drawStatusBubble(ctx, character, 'CEO', seed);
    if (company) {
      const label = company.ceo_name || 'CEO';
      if (this.hoveredId === 'ceo' || this.selectedId === 'ceo') this.drawNameTag(ctx, character, label, 'Chief Executive Officer');
    }
  }

  drawPerson(ctx, character, { shirt, skin, hair, seed, seated, crown = false }) {
    const { x, y } = character;
    const walk = character.moving;
    const frame = walk ? Math.floor(character.phase) % 2 : 0;
    const bob = !walk && !seated ? Math.round(Math.sin(character.phase) * 1) : 0;
    const baseY = y + bob;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x - 8, baseY - 2, 16, 4);
    const legColor = '#202c45';
    if (seated) {
      ctx.fillStyle = legColor;
      ctx.fillRect(x - 5, baseY - 8, 4, 8);
      ctx.fillRect(x + 1, baseY - 8, 4, 8);
    } else {
      ctx.fillStyle = legColor;
      if (walk) {
        ctx.fillRect(x - 6, baseY - 9 + frame * 2, 4, 9 - frame * 2);
        ctx.fillRect(x + 2, baseY - 9 + (1 - frame) * 2, 4, 9 - (1 - frame) * 2);
      } else {
        ctx.fillRect(x - 5, baseY - 9, 4, 9);
        ctx.fillRect(x + 1, baseY - 9, 4, 9);
      }
      ctx.fillStyle = '#101a2b';
      ctx.fillRect(x - 6, baseY - 1, 5, 2);
      ctx.fillRect(x + 1, baseY - 1, 5, 2);
    }
    const bodyTop = baseY - 26;
    ctx.fillStyle = shirt;
    ctx.fillRect(x - 7, bodyTop + 7, 14, 12);
    ctx.fillStyle = this.shade(shirt, -22);
    ctx.fillRect(x - 7, bodyTop + 15, 14, 4);
    ctx.fillStyle = skin;
    ctx.fillRect(x - 9, bodyTop + 8, 2, 7);
    ctx.fillRect(x + 7, bodyTop + 8, 2, 7);
    if (seated && character.state === 'working') {
      const tap = Math.floor(character.typing) % 2;
      ctx.fillStyle = skin;
      ctx.fillRect(x - 11, bodyTop + 13 - tap, 4, 2);
      ctx.fillRect(x + 7, bodyTop + 12 + tap, 4, 2);
      ctx.fillStyle = '#c9d8ea';
      ctx.fillRect(x - 12, bodyTop + 15 - tap, 4, 2);
      ctx.fillRect(x + 8, bodyTop + 14 + tap, 4, 2);
    }
    ctx.fillStyle = skin;
    ctx.fillRect(x - 5, bodyTop - 2, 10, 9);
    ctx.fillStyle = hair;
    ctx.fillRect(x - 5, bodyTop - 3, 10, 4);
    ctx.fillRect(x - 6, bodyTop - 1, 2, 3);
    ctx.fillRect(x + 4, bodyTop - 1, 2, 3);
    if ((seed >> 6) % 4 === 0) ctx.fillRect(x - 4, bodyTop + 7, 8, 2);
    const face = character.face;
    ctx.fillStyle = '#132033';
    if (face === 'left') {
      ctx.fillRect(x - 4, bodyTop + 2, 2, 2);
    } else if (face === 'right') {
      ctx.fillRect(x + 2, bodyTop + 2, 2, 2);
    } else {
      ctx.fillRect(x - 3, bodyTop + 2, 2, 2);
      ctx.fillRect(x + 1, bodyTop + 2, 2, 2);
    }
    if ((seed >> 8) % 3 === 0) {
      ctx.fillStyle = 'rgba(210,235,255,0.5)';
      ctx.fillRect(x - 4, bodyTop + 1, 8, 1);
    }
    if (crown) {
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(x - 5, bodyTop - 8, 10, 4);
      ctx.fillRect(x - 5, bodyTop - 11, 2, 4);
      ctx.fillRect(x - 1, bodyTop - 12, 2, 5);
      ctx.fillRect(x + 3, bodyTop - 11, 2, 4);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(x - 1, bodyTop - 8, 2, 2);
    }
  }

  drawStatusBubble(ctx, character, status, seed) {
    const icons = { Bekerja: '⌨', Rapat: '💬', Idle: '💤', CEO: '★', Nonaktif: '×' };
    const icon = icons[status];
    if (!icon) return;
    if (status === 'Idle' && (seed % 3 !== 0)) return;
    const x = character.x + 10;
    const y = character.y - 42;
    ctx.fillStyle = 'rgba(7,16,29,0.85)';
    ctx.fillRect(x - 7, y - 7, 15, 14);
    ctx.strokeStyle = 'rgba(120,150,200,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 7.5, y - 7.5, 16, 15);
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dbe7f8';
    ctx.fillText(icon, x, y + 1);
    ctx.textAlign = 'left';
  }

  drawNameTag(ctx, character, name, role) {
    const text = `${name} · ${role}`;
    ctx.font = '700 9px monospace';
    const width = Math.min(220, ctx.measureText(text).width + 12);
    const x = Math.max(4, Math.min(W - width - 4, character.x - width / 2));
    const y = Math.max(4, character.y - 58);
    ctx.fillStyle = 'rgba(5,11,20,0.94)';
    ctx.fillRect(x, y, width, 15);
    ctx.strokeStyle = '#f5b942';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 14);
    ctx.fillStyle = '#ffe2a6';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 6, y + 8, width - 10);
  }

  drawSelection(ctx) {
    const id = this.hoveredId || this.selectedId;
    if (!id) return;
    const character = id === 'ceo' ? this.ceo : this.characters.get(id);
    if (!character) return;
    ctx.strokeStyle = '#f5b942';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(character.x) - 12, Math.round(character.y) - 38, 24, 42);
    ctx.fillStyle = 'rgba(245,185,66,0.1)';
    ctx.fillRect(Math.round(character.x) - 12, Math.round(character.y) - 38, 24, 42);
  }

  drawLabels(ctx) {
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(160,185,220,0.55)';
    ctx.fillText('KANTOR PUSAT · LANTAI 1', 22, 634);
    const statusCount = this.agents.filter((agent) => agent.status === 'Bekerja').length;
    ctx.fillStyle = 'rgba(160,185,220,0.55)';
    ctx.textAlign = 'right';
    ctx.fillText(`${this.agents.filter((agent) => agent.active !== false).length} agen · ${statusCount} bekerja`, 978, 634);
    ctx.textAlign = 'left';
  }

  handleClick(event) {
    const point = this.toLogical(event);
    const hit = this.hitTest(point.x, point.y);
    if (!hit) return;
    this.selectedId = hit;
    if (hit === 'ceo') {
      if (this.onSelect) this.onSelect({ type: 'ceo' });
    } else {
      const agent = this.agentsById?.get(hit);
      if (agent && this.onSelect) this.onSelect({ type: 'agent', agent });
    }
    this.draw();
  }

  handleMove(event) {
    const point = this.toLogical(event);
    const hit = this.hitTest(point.x, point.y);
    this.hoveredId = hit;
    this.canvas.style.cursor = hit ? 'pointer' : 'default';
    this.draw();
  }

  toLogical(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  }

  hitTest(x, y) {
    const candidates = [];
    for (const character of this.characters.values()) {
      candidates.push({ id: character.id, x: character.x, y: character.y });
    }
    candidates.push({ id: 'ceo', x: this.ceo.x, y: this.ceo.y });
    let best = null;
    for (const candidate of candidates) {
      if (x >= candidate.x - 14 && x <= candidate.x + 14 && y >= candidate.y - 38 && y <= candidate.y + 8) {
        const distance = Math.abs(x - candidate.x) + Math.abs(y - candidate.y);
        if (!best || distance < best.distance) best = { id: candidate.id, distance };
      }
    }
    return best?.id || null;
  }

  hexAlpha(hex, alpha) {
    const clean = String(hex || '#ffffff').replace('#', '');
    const value = clean.length === 3
      ? clean.split('').map((char) => char + char).join('')
      : clean.padEnd(6, '0').slice(0, 6);
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  shade(hex, amount) {
    const clean = String(hex || '#ffffff').replace('#', '');
    const value = clean.length === 3
      ? clean.split('').map((char) => char + char).join('')
      : clean.padEnd(6, '0').slice(0, 6);
    const clamp = (n) => Math.max(0, Math.min(255, n + amount));
    const r = clamp(parseInt(value.slice(0, 2), 16));
    const g = clamp(parseInt(value.slice(2, 4), 16));
    const b = clamp(parseInt(value.slice(4, 6), 16));
    return `rgb(${r},${g},${b})`;
  }

  destroy() {
    this.setActive(false);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('mousemove', this.onCanvasMove);
  }
}

export { ROOMS };
