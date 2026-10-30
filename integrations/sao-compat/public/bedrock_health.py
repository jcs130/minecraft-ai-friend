"""Bounded real RakNet health and Windows child socket ownership checks."""
import ctypes, os, socket, struct, time
MAGIC=bytes.fromhex('00ffff00fefefefefdfdfdfd12345678')

def decode_pong(data,stamp):
 if len(data)<35 or data[0]!=0x1c or data[1:9]!=struct.pack('>q',stamp)or data[17:33]!=MAGIC or len(data)!=35+struct.unpack('>H',data[33:35])[0]:raise ValueError('invalid_raknet_pong')
 fields=data[35:].decode('utf-8').split(';')
 if len(fields)<12 or fields[0]!='MCPE':raise ValueError('invalid_bedrock_advertisement')
 return {'motd':fields[1],'protocol':int(fields[2]),'version':fields[3],'online':int(fields[4]),'maxPlayers':int(fields[5]),'port':int(fields[10])}

def probe(port):
 stamp=time.time_ns()//1000000;started=time.monotonic()
 with socket.socket(socket.AF_INET,socket.SOCK_DGRAM)as stream:
  stream.settimeout(1);stream.connect(('127.0.0.1',port));stream.send(b'\x01'+struct.pack('>q',stamp)+MAGIC+struct.pack('>q',0x4d415753414f5141));data=stream.recv(4096)
 result=decode_pong(data,stamp)
 if result['port']!=port or result['motd']!='My Agent World SAO':raise ValueError('wrong_bedrock_endpoint')
 return {**result,'latencyMs':round((time.monotonic()-started)*1000,2)}

def check_owner(port,pid,address):
 if os.name!='nt':return
 from ctypes import wintypes as w
 class Row(ctypes.Structure):_fields_=[('address',w.DWORD),('port',w.DWORD),('pid',w.DWORD)]
 class Row6(ctypes.Structure):_fields_=[('address',ctypes.c_ubyte*16),('scope',w.DWORD),('port',w.DWORD),('pid',w.DWORD)]
 api=ctypes.WinDLL('iphlpapi',use_last_error=True).GetExtendedUdpTable
 api.argtypes=[ctypes.c_void_p,ctypes.POINTER(w.DWORD),w.BOOL,w.ULONG,ctypes.c_int,w.ULONG];api.restype=w.DWORD
 def rows(family,kind):
  size=w.DWORD();code=api(None,ctypes.byref(size),False,family,1,0)
  if code not in(0,122):raise OSError('udp_owner_table_unavailable')
  buf=ctypes.create_string_buffer(max(size.value,4))
  if api(buf,ctypes.byref(size),False,family,1,0):raise OSError('udp_owner_table_unavailable')
  return [kind.from_buffer_copy(buf,4+i*ctypes.sizeof(kind))for i in range(w.DWORD.from_buffer(buf).value)]
 matches=[socket.inet_ntoa(struct.pack('=I',r.address))for r in rows(2,Row)if socket.ntohs(r.port&0xffff)==port and r.pid==pid]
 if matches!=[address]:raise RuntimeError('bedrock_socket_owner_or_address_mismatch')
 if any(socket.ntohs(r.port&0xffff)==port and r.pid==pid for r in rows(23,Row6)):raise RuntimeError('unexpected_ipv6_bedrock_socket')
