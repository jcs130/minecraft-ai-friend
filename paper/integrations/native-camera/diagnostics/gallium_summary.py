"""Read complete Gallium trace calls, including the intact prefix of a crash trace."""
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET


def summarize(path: Path):
    parser=ET.XMLPullParser(events=("start","end")); root=None
    calls=Counter(); active=set(); created=destroyed=high_water=0
    partial=overflow=False
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda:stream.read(65536),b""):
                parser.feed(chunk)
                for event,element in parser.read_events():
                    if root is None and event=="start": root=element
                    if event!="end" or element.tag!="call": continue
                    method=element.get("method",""); calls[method]+=1
                    if method in {"resource_create","resource_create_unbacked","resource_create_with_modifiers","resource_from_handle","resource_from_user_memory"}:
                        pointer=element.findtext("ret/ptr")
                        if pointer and pointer not in {"0","0x0","NULL"}:
                            created+=1
                            if len(active)<100_000: active.add(pointer)
                            else: overflow=True
                            high_water=max(high_water,len(active))
                    elif method=="resource_destroy":
                        pointer=element.findtext("arg[@name='resource']/ptr")
                        if pointer:
                            destroyed+=1; active.discard(pointer)
                    element.clear()
                    if root is not None: root.clear()
        parser.close()
    except ET.ParseError:
        partial=True
    return {"scope":"observed Gallium pipe resources, not D3D12 heaps/backing stores", "partialXml":partial,
            "ledgerOverflow":overflow,"resourceCreates":created,"resourceDestroyCalls":destroyed,
            "outstandingObservedPointers":len(active),"highWaterObservedPointers":high_water,"calls":dict(calls)}
