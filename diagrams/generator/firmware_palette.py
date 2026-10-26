"""Apply the reviewed Band firmware colors after the shared style pass."""
import re

# Element offsets in the existing native firmware frame; no IDs are allocated.
PALETTE = {
    ('re', 1): ('#e9edf2', '#b5bfca'),
    ('re', 10): ('#f1f3f5', '#c5ccd4'),
    ('te', 11): (None, '#1e1e1e'),
    ('re', 12): ('#d0ebff', '#9cbfd9'),
    ('re', 17): ('#d0ebff', '#9cbfd9'),
    ('re', 23): ('#d0ebff', '#9cbfd9'),
    ('re', 45): ('#f1f3f5', '#c5ccd4'),
    ('te', 46): (None, '#1e1e1e'),
    ('re', 62): ('#f1f3f5', '#c5ccd4'),
    ('te', 63): (None, '#1e1e1e'),
    ('bx', 4): ('#f8fafc', '#b7c8d4'),
    ('bx', 6): ('#f8fafc', '#b7c8d4'),
    ('bx', 8): ('#f8fafc', '#b7c8d4'),
    ('bx', 15): ('#f8fafc', '#b7c8d4'),
    ('bx', 19): ('#ffd8a8', '#d8b68e'),
    ('bx', 21): ('#ffc9c9', '#d4a3a3'),
    ('bx', 25): ('#f8fafc', '#b7c8d4'),
    ('bx', 27): ('#e5dbff', '#c4b5db'),
    ('bx', 29): ('#e5dbff', '#c4b5db'),
    ('bx', 31): ('#e5dbff', '#c4b5db'),
    ('bx', 47): ('#d0ebff', '#9cbfd9'),
    ('bx', 52): ('#e5dbff', '#c4b5db'),
    ('bx', 54): ('#d0ebff', '#9cbfd9'),
    ('bx', 64): ('#d0ebff', '#9cbfd9'),
    ('bx', 69): ('#e5dbff', '#c4b5db'),
    ('bx', 71): ('#d0ebff', '#9cbfd9'),
    ('bx', 73): ('#e5dbff', '#c4b5db'),
    ('bx', 75): ('#e5dbff', '#c4b5db'),
    ('bx', 77): ('#e5dbff', '#c4b5db'),
}

def apply_firmware_palette(scene):
    frame = next(e for e in scene['elements'] if e['type'] == 'frame'
                 and re.sub(r'^\d+ · ', '', e.get('name', '')) == 'Band firmware')
    base = int(re.fullmatch(r'frame(\d+)', frame['id']).group(1))
    children = [e for e in scene['elements'] if e.get('frameId') == frame['id']]
    byid = {e['id']: e for e in children}
    assert len(children) == 87, 'Firmware content changed; review palette mapping before applying'
    assert byid[f'tx{base+20}']['text'] == 'Orange SOS'
    assert byid[f'tx{base+22}']['text'] == 'Red fall'
    assert byid[f'te{base+3}']['text'] == 'ESP32-C3 · band firmware'
    for (prefix, offset), (fill, stroke) in PALETTE.items():
        e = byid[f'{prefix}{base+offset}']
        if fill is not None:
            e['backgroundColor'] = fill
        e['strokeColor'] = stroke
        source = e.get('customData', {}).get('diagramSourceColor')
        if source is not None:
            source.update(fill=e['backgroundColor'], stroke=e['strokeColor'])
    return scene
