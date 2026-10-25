"""Apply the shared presentation style to generated Excalidraw frames."""

import copy
import re
import textwrap


STYLE_VERSION = 1
SCALE = 1.8
FRAME_GAP = 220
FONT = 5
BODY_SIZE = 48
ARROW_SIZE = 40
ZONE_SIZE = 48
LINE_HEIGHT = 1.25

FRAME_NAMES = (
    ("Band1t", "Overview"),
    ("Architecture",),
    ("SpacetimeDB", "SpacetimeDB live loop"),
    ("Queues",),
    ("Vision",),
    ("Event data", "Event data pipeline"),
    ("Evidence Engine", "The Evidence Engine"),
    ("Claim Settlement",),
    ("Claude", "Claude jobs"),
    ("Social",),
    ("Interests",),
    ("Merch and wallet",),
    ("Capital One Nessie", "Nessie wallet"),
    ("Vultr", "Vultr server"),
    ("Hardware", "Hardware basics"),
    ("Medic routing",),
    ("Medic walk",),
    ("Light circle",),
    ("Exits",),
)
FRAME_LOOKUP = {
    alias: (number, names[0])
    for number, names in enumerate(FRAME_NAMES, 1)
    for alias in names
}


def _bounds(element):
    if element.get("points"):
        xs = [element["x"] + p[0] for p in element["points"]]
        ys = [element["y"] + p[1] for p in element["points"]]
        return min(xs), min(ys), max(xs), max(ys)
    return (element["x"], element["y"],
            element["x"] + element["width"], element["y"] + element["height"])


def _contains(outer, inner):
    x0, y0, x1, y1 = _bounds(outer)
    a0, b0, a1, b1 = _bounds(inner)
    return x0 - 1 <= a0 and y0 - 1 <= b0 and a1 <= x1 + 1 and b1 <= y1 + 1


def _bound_text(element, by_id):
    return [by_id[b["id"]] for b in element.get("boundElements") or []
            if b.get("type") == "text" and b["id"] in by_id]


def _text(element, size, width=None, center=None, position=None, align=None):
    body = element.get("originalText", element.get("text", ""))
    lines = []
    for paragraph in body.split("\n"):
        if width:
            columns = max(8, int((width - 4) / (size * 0.64)))
            lines.extend(textwrap.wrap(paragraph, columns, break_long_words=False,
                                       break_on_hyphens=False) or [""])
        else:
            lines.append(paragraph)
    w = max((len(line) for line in lines), default=0) * size * 0.64 + 4
    h = len(lines) * size * LINE_HEIGHT
    element.update(text="\n".join(lines), fontFamily=FONT, fontSize=size,
                   lineHeight=LINE_HEIGHT, width=w, height=h, autoResize=True)
    if align:
        element["textAlign"] = align
    if center:
        element["x"], element["y"] = center[0] - w / 2, center[1] - h / 2
    if position:
        element["x"], element["y"] = position
    return w, h


def _scale(element, origin, target):
    element["x"] = target[0] + (element["x"] - origin[0]) * SCALE
    element["y"] = target[1] + (element["y"] - origin[1]) * SCALE
    element["width"] *= SCALE
    element["height"] *= SCALE
    if element.get("points"):
        element["points"] = [[x * SCALE, y * SCALE] for x, y in element["points"]]
    for key in ("startBinding", "endBinding"):
        if element.get(key) and "gap" in element[key]:
            element[key]["gap"] *= SCALE


def _image_size(image, max_height, max_width):
    aspect = image["width"] / image["height"]
    height = min(max_height, max_width / aspect)
    return height * aspect, height


def _position_arrow(arrow, old_boxes, by_id):
    points = [[arrow["x"] + p[0], arrow["y"] + p[1]] for p in arrow["points"]]
    for key, index, adjacent in (("startBinding", 0, 1), ("endBinding", -1, -2)):
        binding = arrow.get(key)
        if not binding or binding["elementId"] not in old_boxes:
            continue
        old = old_boxes[binding["elementId"]]
        new = by_id[binding["elementId"]]
        previous = points[index][:]
        points[index] = [new["x"] + (previous[0] - old["x"]) / old["width"] * new["width"],
                         new["y"] + (previous[1] - old["y"]) / old["height"] * new["height"]]
        if len(points) > 2:
            if abs(previous[0] - points[adjacent][0]) < 0.01:
                points[adjacent][0] = points[index][0]
            if abs(previous[1] - points[adjacent][1]) < 0.01:
                points[adjacent][1] = points[index][1]
    arrow["x"], arrow["y"] = points[0]
    arrow["points"] = [[x - arrow["x"], y - arrow["y"]] for x, y in points]
    arrow["width"] = max(x for x, _ in points) - min(x for x, _ in points)
    arrow["height"] = max(y for _, y in points) - min(y for _, y in points)
    middle = len(points) // 2
    center = (points[middle] if len(points) % 2 else
              [(a + b) / 2 for a, b in zip(points[middle - 1], points[middle])])
    before = points[max(0, middle - 1)]
    after = points[min(len(points) - 1, middle + (len(points) % 2))]
    label_width = max(80, abs(after[0] - before[0]) - 24) if abs(after[1] - before[1]) < 0.01 else None
    for label in _bound_text(arrow, by_id):
        _text(label, ARROW_SIZE, width=label_width, center=center, align="center")


def _style_frame(frame, children, target_y):
    by_id = {e["id"]: e for e in children}
    removed = set()
    for element in children:
        labels = _bound_text(element, by_id)
        if (element["type"] == "ellipse" and element.get("backgroundColor") == "#1e1e1e"
                and len(labels) == 1 and labels[0].get("text", "").isdigit()):
            removed.update((element["id"], labels[0]["id"]))
        if (element["type"] == "text" and not element.get("containerId")
                and element.get("fontSize") in (48, 64)
                and abs(element["x"] - frame["x"] - 40) < 1
                and abs(element["y"] - frame["y"] - 28) < 1):
            removed.add(element["id"])
    children = [e for e in children if e["id"] not in removed]
    by_id = {e["id"]: e for e in children}
    for element in children:
        if element.get("boundElements"):
            element["boundElements"] = [b for b in element["boundElements"] if b["id"] not in removed]

    cards = [e for e in children if e["type"] in ("rectangle", "diamond", "ellipse")
             and _bound_text(e, by_id)]
    zones = [e for e in children if e["type"] == "rectangle" and not _bound_text(e, by_id)
             and e.get("roughness") == 0 and e.get("strokeWidth") == 1]
    groups = {group: card for card in cards for group in card.get("groupIds", [])}
    card_images = {e["id"]: [] for e in cards}
    zone_images = {e["id"]: [] for e in zones}
    zone_labels = {}
    unattached_images = []
    for element in children:
        if element["type"] == "image":
            owner = next((groups[g] for g in element.get("groupIds", []) if g in groups), None)
            if owner is None:
                containing = [card for card in cards if _contains(card, element)]
                owner = min(containing, key=lambda c: c["width"] * c["height"], default=None)
            if owner is not None:
                card_images[owner["id"]].append(element)
            else:
                headers = [zone for zone in zones if _contains(zone, element)
                           and 0 <= element["y"] - zone["y"] <= 24 and element["height"] <= 64]
                owner = min(headers, key=lambda z: z["width"] * z["height"], default=None)
                if owner is not None:
                    zone_images[owner["id"]].append(element)
                else:
                    unattached_images.append(element)
        elif element["type"] == "text" and not element.get("containerId"):
            headers = [zone for zone in zones if zone["x"] <= element["x"] <= zone["x"] + zone["width"]
                       and 0 <= element["y"] - zone["y"] <= 24]
            owner = min(headers, key=lambda z: z["width"] * z["height"], default=None)
            if owner is not None:
                zone_labels[element["id"]] = owner

    origin = frame["x"], frame["y"]
    target = frame["x"], target_y
    for element in children:
        _scale(element, origin, target)
        element["roughness"] = 0
        if element["type"] not in ("text", "image"):
            element["strokeWidth"] = 1 if element in zones else 2
    frame["y"] = target_y
    frame["width"] *= SCALE
    frame["height"] *= SCALE
    frame.update(roughness=0, strokeWidth=1)
    old_boxes = {card["id"]: {key: card[key] for key in ("x", "y", "width", "height")} for card in cards}

    handled_text = set()
    for card in cards:
        if card.get("strokeColor") not in ("#c92a2a", "#2b8a3e") or card.get("backgroundColor") == "#ffc9c9":
            card["backgroundColor"] = "#ffffff"
        labels = _bound_text(card, by_id)
        label = labels[0]
        usable_width = card["width"] * (0.62 if card["type"] == "diamond" else 1) - 64
        _, text_height = _text(label, BODY_SIZE, width=usable_width, align="center")
        label["strokeColor"] = "#1e1e1e"
        images = sorted(card_images[card["id"]], key=lambda im: (im["x"], im["y"]))
        image_height = 0
        gap = 20
        sizes = []
        if images:
            max_height = 200 if card["height"] >= 600 else 128
            sizes = [_image_size(im, max_height, min(520, usable_width)) for im in images]
            row_width = sum(w for w, _ in sizes) + gap * (len(images) - 1)
            if row_width > usable_width:
                ratio = (usable_width - gap * (len(images) - 1)) / sum(w for w, _ in sizes)
                sizes = [(w * ratio, h * ratio) for w, h in sizes]
            image_height = max(h for _, h in sizes)
        content_height = text_height + (image_height + 12 if images else 0)
        minimum_height = content_height + 24
        if card["type"] == "diamond":
            minimum_height = content_height * 2 + 50
        if card["height"] < minimum_height:
            card["y"] -= (minimum_height - card["height"]) / 2
            card["height"] = minimum_height
        top = card["y"] + (card["height"] - content_height) / 2
        if images:
            row_width = sum(w for w, _ in sizes) + gap * (len(images) - 1)
            left = card["x"] + (card["width"] - row_width) / 2
            for im, (width, height) in zip(images, sizes):
                im.update(x=left, y=top + (image_height - height) / 2, width=width, height=height)
                im["groupIds"] = list(card.get("groupIds", []))
                left += width + gap
            top += image_height + 12
        label["x"] = card["x"] + (card["width"] - label["width"]) / 2
        label["y"] = top
        label["verticalAlign"] = "bottom" if images else "middle"
        handled_text.add(label["id"])

    for zone in zones:
        left = zone["x"] + 32
        first_row = min((card["y"] for card in cards
                         if zone["x"] < card["x"] + card["width"] / 2 < zone["x"] + zone["width"]
                         and zone["y"] < card["y"] + card["height"] / 2 < zone["y"] + zone["height"]),
                        default=zone["y"] + 128)
        header_height = max(32, min(96, first_row - zone["y"] - 26))
        for image in zone_images[zone["id"]]:
            width, height = _image_size(image, header_height, 400)
            image.update(x=left, y=zone["y"] + 16, width=width, height=height)
            left += width + 16
        for label_id, owner in zone_labels.items():
            if owner["id"] != zone["id"]:
                continue
            label = by_id[label_id]
            _text(label, ZONE_SIZE, width=zone["x"] + zone["width"] - left - 24,
                  position=(left, zone["y"] + 16), align="left")
            handled_text.add(label_id)

    for image in unattached_images:
        # Large standalone maps keep their size, aspect and position in the flow.
        if image["width"] >= 600 or image["height"] >= 600:
            continue
        cx, cy = image["x"] + image["width"] / 2, image["y"] + image["height"] / 2
        width, height = _image_size(image, 128, 520)
        image.update(x=cx - width / 2, y=cy - height / 2, width=width, height=height)

    for element in children:
        if element["type"] == "arrow":
            _position_arrow(element, old_boxes, by_id)
            handled_text.update(t["id"] for t in _bound_text(element, by_id))
    for element in children:
        if element["type"] == "text" and element["id"] not in handled_text:
            center = element["x"] + element["width"] / 2, element["y"] + element["height"] / 2
            _text(element, BODY_SIZE, center=center)
    if children:
        frame["width"] = max(frame["width"], max(_bounds(e)[2] for e in children) - frame["x"] + 40)
        frame["height"] = max(frame["height"], max(_bounds(e)[3] for e in children) - frame["y"] + 40)
    frame.setdefault("customData", {})["diagramStyleVersion"] = STYLE_VERSION
    return children


def style_scene(scene, start_number=1):
    """Return a styled copy; already styled frames can be safely assembled again."""
    result = copy.deepcopy(scene)
    frames = sorted((e for e in result["elements"] if e["type"] == "frame"),
                    key=lambda e: (e["y"], e["x"]))
    if not frames:
        return result
    frame_ids = {frame["id"] for frame in frames}
    children_by_frame = {frame["id"]: [e for e in result["elements"] if e.get("frameId") == frame["id"]]
                         for frame in frames}
    untouched = [e for e in result["elements"] if e["id"] not in frame_ids and e.get("frameId") not in frame_ids]
    output = []
    y = frames[0]["y"]
    for index, frame in enumerate(frames, start_number):
        name = re.sub(r"^(?:\d+\s*·\s*)+", "", frame.get("name", "")).strip()
        number, name = FRAME_LOOKUP.get(name, (index, name))
        children = children_by_frame[frame["id"]]
        if (frame.get("customData") or {}).get("diagramStyleVersion") == STYLE_VERSION:
            delta = y - frame["y"]
            for element in children:
                element["y"] += delta
            frame["y"] = y
        else:
            children = _style_frame(frame, children, y)
        frame["name"] = f"{number:02d} · {name}"
        output.extend(children)
        output.append(frame)
        y = frame["y"] + frame["height"] + FRAME_GAP
    result["elements"] = untouched + output
    return result
