"""Preview/renew Geyser mappings and configured public signaling aliases; no delete/restart."""
import argparse,ipaddress,json,socket,urllib.request,urllib.error,urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

MAPPINGS=((19132,'UDP','Qiandengji-Geyser-RakNet'),(19132,'TCP','Qiandengji-Geyser-Signaling'),(19133,'UDP','Qiandengji-Geyser-WebRTC'))

def reconcile(invoke,client,apply=False,signaling_aliases=()):
    address=ipaddress.ip_address(client)
    if address.version!=4 or not address.is_private or address.is_loopback:raise ValueError('Expected the game host private IPv4 address')
    if not isinstance(signaling_aliases,(list,tuple)) or len(signaling_aliases)>4:raise ValueError('Expected at most four public signaling aliases')
    if any(type(port)is not int or port<1024 or port>65535 or port==19132 for port in signaling_aliases):raise ValueError('Invalid public signaling alias port')
    if len(set(signaling_aliases))!=len(signaling_aliases):raise ValueError('Duplicate public signaling aliases')
    specs=[(port,protocol,description,port)for port,protocol,description in MAPPINGS]
    specs.extend((port,'TCP','Qiandengji-Geyser-Signaling-'+str(port),19132)for port in signaling_aliases)
    plan=[]
    # Validate every destination before creating or renewing any mapping.
    for port,protocol,description,internal_port in specs:
        query={'NewRemoteHost':'','NewExternalPort':port,'NewProtocol':protocol}
        before=invoke('GetSpecificPortMappingEntry',query)
        missing=before.get('errorCode')=='714'
        if before.get('errorCode') and not missing:raise RuntimeError('Cannot inspect '+protocol+'/'+str(port)+': UPnP '+str(before['errorCode']))
        if not missing and (before.get('NewInternalClient')!=client or before.get('NewInternalPort')!=str(internal_port)):
            raise RuntimeError(protocol+'/'+str(port)+' belongs to another destination; no mappings changed')
        plan.append({'port':port,'internalPort':internal_port,'protocol':protocol,'description':before.get('NewPortMappingDescription')or description,'before':before,'missing':missing})
    for row in plan:
        row['changed']=False
        if not apply:continue
        if not row['missing'] and row['before'].get('NewEnabled')=='1' and row['before'].get('NewLeaseDuration')=='0':continue
        fields={'NewRemoteHost':'','NewExternalPort':row['port'],'NewProtocol':row['protocol'],'NewInternalPort':row['internalPort'],'NewInternalClient':client,'NewEnabled':1,'NewPortMappingDescription':row['description'],'NewLeaseDuration':0}
        reply=invoke('AddPortMapping',fields)
        if reply.get('errorCode'):raise RuntimeError('Router refused '+row['protocol']+'/'+str(row['port'])+': UPnP '+str(reply['errorCode']))
        after=invoke('GetSpecificPortMappingEntry',{k:fields[k]for k in ['NewRemoteHost','NewExternalPort','NewProtocol']})
        if after.get('NewInternalClient')!=client or after.get('NewInternalPort')!=str(row['internalPort']) or after.get('NewEnabled')!='1':raise RuntimeError('Router mapping readback failed')
        row['after']=after;row['changed']=True
    return {'applied':apply,'mappings':plan,'routerChanged':any(r['changed']for r in plan)}

def soap_client(url):
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!='http' or parsed.username or parsed.password or parsed.query or parsed.fragment or not ipaddress.ip_address(parsed.hostname).is_private:raise ValueError('Expected an explicit private router control URL')
    service='urn:schemas-upnp-org:service:WANIPConnection:1'
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):raise RuntimeError('Router redirects are not accepted')
    opener=urllib.request.build_opener(NoRedirect)
    def invoke(action,fields):
        if action not in ['GetSpecificPortMappingEntry','AddPortMapping','GetExternalIPAddress']:raise ValueError('Unsupported router operation')
        envelope=ET.Element('s:Envelope',{'xmlns:s':'http://schemas.xmlsoap.org/soap/envelope/','s:encodingStyle':'http://schemas.xmlsoap.org/soap/encoding/'})
        node=ET.SubElement(ET.SubElement(envelope,'s:Body'),'u:'+action,{'xmlns:u':service})
        for key,value in fields.items():ET.SubElement(node,key).text=str(value)
        request=urllib.request.Request(url,data=ET.tostring(envelope,encoding='utf-8',xml_declaration=True),headers={'Content-Type':'text/xml; charset="utf-8"','SOAPAction':'"'+service+'#'+action+'"'})
        try:
            with opener.open(request,timeout=5)as response:data=response.read(65537)
        except urllib.error.HTTPError as error:data=error.read(65537)
        if len(data)>65536:raise RuntimeError('Router response is too large')
        return {x.tag.split('}')[-1]:x.text for x in ET.fromstring(data).iter()if len(x)==0}
    return invoke

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=Path,required=True);parser.add_argument('--report',type=Path);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    config=json.loads(args.config.read_text(encoding='utf-8-sig'));invoke=soap_client(config['routerControlUrl'])
    external=invoke('GetExternalIPAddress',{}).get('NewExternalIPAddress')
    if external not in {entry[4][0]for entry in socket.getaddrinfo(config['publicHost'],None,socket.AF_INET)}:raise RuntimeError('Router external address does not match the published game hostname')
    result=reconcile(invoke,config['internalClient'],args.apply,config.get('signalingAliases',[]))
    if args.report:args.report.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))

if __name__=='__main__':main()
