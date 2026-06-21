'use strict'

const fs = require('node:fs')
const path = require('node:path')

class DataStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir
    this.logger = options.logger
    this.sqlitePath = path.join(this.dataDir, 'ai-friend.sqlite')
    this.jsonlPath = path.join(this.dataDir, 'events.jsonl')
    this.backend = 'jsonl'
    this.sqliteError = ''
    this.db = null
    this.init()
  }

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true })

    try {
      const { DatabaseSync } = require('node:sqlite')
      this.db = new DatabaseSync(this.sqlitePath)
      this.backend = 'sqlite'
      this.migrate()
    } catch (error) {
      this.backend = 'jsonl'
      this.sqliteError = error.message
      if (this.logger) this.logger.warn(`SQLite unavailable, using JSONL event log: ${error.message}`)
    }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        agent TEXT,
        title TEXT NOT NULL,
        description TEXT,
        project_id TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_task_events_at ON task_events(at);
      CREATE INDEX IF NOT EXISTS idx_task_events_agent ON task_events(agent);
      CREATE INDEX IF NOT EXISTS idx_task_events_project ON task_events(project_id);

      CREATE TABLE IF NOT EXISTS infrastructure_reports (
        id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        created_at TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        public INTEGER NOT NULL,
        agent TEXT,
        title TEXT NOT NULL,
        description TEXT,
        project_id TEXT,
        checklist_id TEXT,
        position_json TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_infrastructure_reports_updated_at ON infrastructure_reports(updated_at);
      CREATE INDEX IF NOT EXISTS idx_infrastructure_reports_agent ON infrastructure_reports(agent);
      CREATE INDEX IF NOT EXISTS idx_infrastructure_reports_project ON infrastructure_reports(project_id);

      CREATE TABLE IF NOT EXISTS agent_observations (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        agent TEXT NOT NULL,
        online INTEGER NOT NULL,
        action TEXT,
        position_json TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_observations_at ON agent_observations(at);
      CREATE INDEX IF NOT EXISTS idx_agent_observations_agent ON agent_observations(agent);

      CREATE TABLE IF NOT EXISTS agent_status_reports (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        agent TEXT NOT NULL,
        status TEXT NOT NULL,
        task TEXT,
        needs_json TEXT,
        has_json TEXT,
        position_json TEXT,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_status_reports_at ON agent_status_reports(at);
      CREATE INDEX IF NOT EXISTS idx_agent_status_reports_agent ON agent_status_reports(agent);

      CREATE TABLE IF NOT EXISTS agent_memories (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        agent TEXT NOT NULL,
        kind TEXT NOT NULL,
        importance INTEGER NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_memories_at ON agent_memories(at);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent);
      CREATE INDEX IF NOT EXISTS idx_agent_memories_kind ON agent_memories(kind);

      CREATE TABLE IF NOT EXISTS agent_memory_vectors (
        memory_id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        model TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_memory_vectors_agent ON agent_memory_vectors(agent);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_vectors_updated_at ON agent_memory_vectors(updated_at);
    `)
  }

  snapshot() {
    return {
      backend: this.backend,
      sqlitePath: this.sqlitePath,
      jsonlPath: this.jsonlPath,
      sqliteReady: Boolean(this.db),
      sqliteError: this.sqliteError
    }
  }

  recordTaskEvent(event) {
    if (!event || !event.id) return
    if (!this.db) {
      this.appendJsonl('task_event', event)
      return
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO task_events (
        id, at, type, status, source, agent, title, description, project_id, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.at || new Date().toISOString(),
      event.type || '',
      event.status || '',
      event.source || '',
      event.agent || '',
      event.title || '',
      event.description || '',
      event.projectId || '',
      stringifyJson(event)
    )
  }

  recordInfrastructureReport(report) {
    if (!report || !report.id) return
    if (!this.db) {
      this.appendJsonl('infrastructure_report', report)
      return
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO infrastructure_reports (
        id, updated_at, created_at, type, status, public, agent, title, description,
        project_id, checklist_id, position_json, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      report.updatedAt || new Date().toISOString(),
      report.createdAt || '',
      report.type || '',
      report.status || '',
      report.public === false ? 0 : 1,
      report.agent || '',
      report.title || '',
      report.description || '',
      report.projectId || '',
      report.checklistId || '',
      stringifyJson(report.position || null),
      stringifyJson(report)
    )
  }

  recordAgentObservation(observation) {
    if (!observation || !observation.agent) return
    const event = {
      id: observation.id || buildObservationId(observation),
      at: observation.at || new Date().toISOString(),
      agent: observation.agent,
      online: Boolean(observation.online),
      action: observation.action || '',
      position: observation.position || null
    }

    if (!this.db) {
      this.appendJsonl('agent_observation', event)
      return
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO agent_observations (
        id, at, agent, online, action, position_json, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.at,
      event.agent,
      event.online ? 1 : 0,
      event.action,
      stringifyJson(event.position),
      stringifyJson(event)
    )
  }

  recordAgentStatusReport(report) {
    if (!report || !report.agent || !report.id) return
    if (!this.db) {
      this.appendJsonl('agent_status_report', report)
      return
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO agent_status_reports (
        id, at, agent, status, task, needs_json, has_json, position_json, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      report.at || new Date().toISOString(),
      report.agent,
      report.status || '',
      report.task || '',
      stringifyJson(report.needs || []),
      stringifyJson(report.has || []),
      stringifyJson(report.position || null),
      stringifyJson(report)
    )
  }

  recordAgentMemory(memory) {
    if (!memory || !memory.agent || !memory.id || !memory.text) return
    if (!this.db) {
      this.appendJsonl('agent_memory', memory)
      return
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO agent_memories (
        id, at, agent, kind, importance, text, source, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.at || new Date().toISOString(),
      memory.agent,
      memory.kind || 'note',
      Number(memory.importance || 1),
      memory.text || '',
      memory.source || 'agent',
      stringifyJson(memory)
    )
  }

  recordAgentMemoryVector(record) {
    if (!record || !record.memoryId || !record.agent || !Array.isArray(record.vector)) return
    if (!this.db) {
      this.appendJsonl('agent_memory_vector', record)
      return
    }

    const vector = record.vector.map(Number).filter(Number.isFinite)
    if (vector.length === 0) return

    this.db.prepare(`
      INSERT OR REPLACE INTO agent_memory_vectors (
        memory_id, agent, model, dimension, vector_json, payload_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.memoryId,
      record.agent,
      record.model || '',
      vector.length,
      stringifyJson(vector),
      stringifyJson(record.payload || {}),
      record.updatedAt || new Date().toISOString()
    )
  }

  recentAgentObservations(agent = '', limit = 50) {
    if (!this.db) return []
    const capped = clampLimit(limit)
    const rows = agent
      ? this.db.prepare(`
          SELECT id, at, agent, online, action, position_json AS positionJson, payload_json AS payloadJson
          FROM agent_observations
          WHERE agent = ?
          ORDER BY at DESC
          LIMIT ?
        `).all(agent, capped)
      : this.db.prepare(`
          SELECT id, at, agent, online, action, position_json AS positionJson, payload_json AS payloadJson
          FROM agent_observations
          ORDER BY at DESC
          LIMIT ?
        `).all(capped)
    return rows.map(row => ({
      ...row,
      online: Boolean(row.online),
      position: parseJson(row.positionJson),
      payload: parseJson(row.payloadJson)
    }))
  }

  recentAgentStatusReports(agent = '', limit = 50) {
    if (!this.db) return []
    const capped = clampLimit(limit)
    const rows = agent
      ? this.db.prepare(`
          SELECT id, at, agent, status, task, needs_json AS needsJson, has_json AS hasJson,
            position_json AS positionJson, payload_json AS payloadJson
          FROM agent_status_reports
          WHERE agent = ?
          ORDER BY at DESC
          LIMIT ?
        `).all(agent, capped)
      : this.db.prepare(`
          SELECT id, at, agent, status, task, needs_json AS needsJson, has_json AS hasJson,
            position_json AS positionJson, payload_json AS payloadJson
          FROM agent_status_reports
          ORDER BY at DESC
          LIMIT ?
        `).all(capped)
    return rows.map(row => ({
      ...row,
      needs: parseJson(row.needsJson) || [],
      has: parseJson(row.hasJson) || [],
      position: parseJson(row.positionJson),
      payload: parseJson(row.payloadJson)
    }))
  }

  recentAgentMemories(agent = '', limit = 50) {
    if (!this.db) return []
    const capped = clampLimit(limit)
    const rows = agent
      ? this.db.prepare(`
          SELECT id, at, agent, kind, importance, text, source, payload_json AS payloadJson
          FROM agent_memories
          WHERE agent = ?
          ORDER BY importance DESC, at DESC
          LIMIT ?
        `).all(agent, capped)
      : this.db.prepare(`
          SELECT id, at, agent, kind, importance, text, source, payload_json AS payloadJson
          FROM agent_memories
          ORDER BY importance DESC, at DESC
          LIMIT ?
        `).all(capped)
    return rows.map(row => ({
      ...row,
      payload: parseJson(row.payloadJson)
    }))
  }

  recentAgentMemoryVectors(agent = '', limit = 1000) {
    if (!this.db) return []
    const capped = clampLimit(limit)
    const rows = agent
      ? this.db.prepare(`
          SELECT memory_id AS memoryId, agent, model, dimension, vector_json AS vectorJson,
            payload_json AS payloadJson, updated_at AS updatedAt
          FROM agent_memory_vectors
          WHERE agent = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(agent, capped)
      : this.db.prepare(`
          SELECT memory_id AS memoryId, agent, model, dimension, vector_json AS vectorJson,
            payload_json AS payloadJson, updated_at AS updatedAt
          FROM agent_memory_vectors
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(capped)
    return rows.map(row => ({
      ...row,
      vector: parseJson(row.vectorJson) || [],
      payload: parseJson(row.payloadJson) || {}
    }))
  }

  recentTaskEvents(limit = 50) {
    if (!this.db) return []
    return this.db.prepare(`
      SELECT id, at, type, status, source, agent, title, description, project_id AS projectId, payload_json AS payloadJson
      FROM task_events
      ORDER BY at DESC
      LIMIT ?
    `).all(clampLimit(limit)).map(row => ({
      ...row,
      payload: parseJson(row.payloadJson)
    }))
  }

  recentInfrastructureReports(limit = 50) {
    if (!this.db) return []
    return this.db.prepare(`
      SELECT id, updated_at AS updatedAt, created_at AS createdAt, type, status, public, agent, title,
        description, project_id AS projectId, checklist_id AS checklistId, position_json AS positionJson,
        payload_json AS payloadJson
      FROM infrastructure_reports
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(clampLimit(limit)).map(row => ({
      ...row,
      public: Boolean(row.public),
      position: parseJson(row.positionJson),
      payload: parseJson(row.payloadJson)
    }))
  }

  appendJsonl(type, payload) {
    const event = {
      type,
      at: new Date().toISOString(),
      payload
    }
    fs.appendFileSync(this.jsonlPath, stringifyJson(event) + '\n')
  }

  close() {
    if (!this.db) return
    this.db.close()
    this.db = null
  }
}

function buildObservationId(observation) {
  const at = String(observation.at || new Date().toISOString()).replace(/[^0-9]/g, '')
  const agent = String(observation.agent || 'agent').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
  return `${agent}-${at}`
}

function clampLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 50
  return Math.max(1, Math.min(200, Math.round(number)))
}

function stringifyJson(value) {
  return JSON.stringify(value == null ? null : value)
}

function parseJson(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

module.exports = { DataStore }
