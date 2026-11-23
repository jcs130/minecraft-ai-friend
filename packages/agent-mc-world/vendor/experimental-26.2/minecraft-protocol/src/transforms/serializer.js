'use strict'

const { ProtoDef, Serializer, FullPacketParser } = require('protodef')
const { ProtoDefCompiler } = require('protodef').Compiler

const nbt = require('prismarine-nbt')
const minecraft = require('../datatypes/minecraft')
const states = require('../states')
const merge = require('lodash.merge')

const minecraftData = require('minecraft-data')
const strictDiscriminators = require('../datatypes/strict-discriminators')
const protocols = {}

function isJava26_2 (mcData) {
  return mcData?.version?.version === 776 || mcData?.version?.minecraftVersion === '26.2'
}

function createProtocol (state, direction, version, customPackets, compiled = true) {
  const key = `${state};${direction};${version}${compiled ? ';c' : ''}`
  if (protocols[key]) { return protocols[key] }

  const mcData = minecraftData(version)
  const versionInfo = minecraftData.versionsByMinecraftVersion.pc[version]
  if (mcData === null) {
    throw new Error(`No data available for version ${version}`)
  } else if (versionInfo && versionInfo.version !== mcData.version.version) {
    // The protocol version returned by node-minecraft-data constructor does not match the data in minecraft-data's protocolVersions.json
    throw new Error(`Unsupported protocol version '${versionInfo.version}' (attempted to use '${mcData.version.version}' data); try updating your packages with 'npm update'`)
  }

  const mergedProtocol = merge({}, mcData.protocol, customPackets?.[mcData.version.majorVersion] ?? {})
  const strict26_2 = isJava26_2(mcData)
  if (strict26_2) {
    // Compiled protodef treats a missing switch default as void (0 bytes).
    // Unknown item components or metadata types must fail closed instead.
    strictDiscriminators.applyStrictDiscriminators(mergedProtocol)
  }

  if (compiled) {
    const compiler = new ProtoDefCompiler()
    compiler.addTypes(require('../datatypes/compiler-minecraft'))
    if (strict26_2) compiler.addTypes(strictDiscriminators.compilerTypes)
    compiler.addProtocol(mergedProtocol, [state, direction])
    nbt.addTypesToCompiler('big', compiler)
    const proto = compiler.compileProtoDefSync()
    protocols[key] = proto
    return proto
  }

  const proto = new ProtoDef(false)
  proto.addTypes(minecraft)
  if (strict26_2) proto.addTypes(strictDiscriminators.interpreterTypes)
  proto.addProtocol(mergedProtocol, [state, direction])
  nbt.addTypesToInterperter('big', proto)
  protocols[key] = proto
  return proto
}

function createSerializer ({ state = states.HANDSHAKING, isServer = false, version, customPackets, compiled = true } = {}) {
  return new Serializer(createProtocol(state, !isServer ? 'toServer' : 'toClient', version, customPackets, compiled), 'packet')
}

function createDeserializer ({ state = states.HANDSHAKING, isServer = false, version, customPackets, compiled = true, noErrorLogging = false } = {}) {
  return new FullPacketParser(createProtocol(state, isServer ? 'toServer' : 'toClient', version, customPackets, compiled), 'packet', noErrorLogging)
}

module.exports = {
  createSerializer,
  createDeserializer
}
