// BandIt v2 "pill" wristband puck, as a native Onshape custom feature.
// Same numbers as bandit_v2.py / bandit_v2.scad. Builds Base and Lid in place (mm, Z up,
// X along the strap, LED ring centred on the origin, tail toward -X).
// Paste below the two header lines of a new Feature Studio, commit, then add the feature in a Part Studio.

annotation { "Feature Type Name" : "BandIt v2 case" }
export const banditV2 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Ring pocket diameter (ring OD + 0.8)" }
        isLength(definition.ringPocket, { (millimeter) : [20, 38.3, 60] } as LengthBoundSpec);
        annotation { "Name" : "Battery pocket length (battery + 2)" }
        isLength(definition.battW, { (millimeter) : [20, 37, 60] } as LengthBoundSpec);
        annotation { "Name" : "Battery pocket width (battery + 2)" }
        isLength(definition.battD, { (millimeter) : [20, 32, 60] } as LengthBoundSpec);
        annotation { "Name" : "Strap channel height (ribbon + 0.3)" }
        isLength(definition.slotH, { (millimeter) : [0.8, 1.3, 3] } as LengthBoundSpec);
        annotation { "Name" : "Lid clearance per side" }
        isLength(definition.clr, { (millimeter) : [0.05, 0.2, 0.5] } as LengthBoundSpec);
    }
    {
        // ---------------- numbers (mm)
        const head = 42; const tailLen = 43; const R = 10; const wall = 1.5;
        const slotW = 17.5; const slotH = definition.slotH / millimeter; const floorT = 1.0;
        const battH = 5.5; const ringLift = 1.0; const ringH = 3.2; const ringGap = 0.4; const lidT = 1.2;
        const lip = 0.8; const clr = definition.clr / millimeter;
        const ringPocket = definition.ringPocket / millimeter;
        const battW = definition.battW / millimeter; const battD = definition.battD / millimeter; const battR = 3;
        const bayXEnd = -41.5; const flareX0 = -18.5; const flareX1 = -24.0; const bayHalf = 19.5;
        const divX0 = -20.0; const divX1 = -18.5; const divGap = 9.2;
        const usbW = 10.6; const usbZ0 = 3.3; const usbZ1 = 7.5;
        const cbW = 14.0; const cbD = 0.7; const cbZ0 = 2.6; const cbZ1 = 8.2;
        const switchH = 5.0; const buttonHole = 6.5;   // 6x6 tactile switch pressed directly through the lid
        const winId = 26.0; const winOd = 39.0; const winDepth = 0.6;   // thin ring on the lid underside over the LEDs

        const floorTop = slotH + floorT; const battTop = floorTop + battH; const seat = battTop + ringLift;
        const ringTop = seat + ringH; const lidBot = ringTop + ringGap; const top = lidBot + lidT;
        const switchTop = battTop + switchH;
        const L = tailLen + head / 2; const cx = (head / 2 - tailLen) / 2;

        // ---------------- helpers
        const zPlane = function(z) { return plane(vector(0, 0, z) * millimeter, vector(0, 0, 1), vector(1, 0, 0)); };
        const vertEdges = function(exId) { return qParallelEdges(qCreatedBy(exId, EntityType.EDGE), vector(0, 0, 1)); };
        // rectangle tool: sketch at z0, extrude up by h, optional fillet of its vertical edges
        const rectTool = function(tid, x0, x1, y0, y1, z0, h, r)
        {
            var sk = newSketchOnPlane(context, tid + "sk", { "sketchPlane" : zPlane(z0) });
            skRectangle(sk, "r", { "firstCorner" : vector(x0, y0) * millimeter, "secondCorner" : vector(x1, y1) * millimeter });
            skSolve(sk);
            opExtrude(context, tid + "ex", { "entities" : qSketchRegion(tid + "sk", true), "direction" : vector(0, 0, 1),
                        "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
            if (r > 0)
                opFillet(context, tid + "f", { "entities" : vertEdges(tid + "ex"), "radius" : r * millimeter });
            opDeleteBodies(context, tid + "dsk", { "entities" : qCreatedBy(tid + "sk", EntityType.BODY) });
            return qCreatedBy(tid + "ex", EntityType.BODY);
        };
        const cylTool = function(tid, d, z0, h)
        {
            var sk = newSketchOnPlane(context, tid + "sk", { "sketchPlane" : zPlane(z0) });
            skCircle(sk, "c", { "center" : vector(0, 0) * millimeter, "radius" : (d / 2) * millimeter });
            skSolve(sk);
            opExtrude(context, tid + "ex", { "entities" : qSketchRegion(tid + "sk", true), "direction" : vector(0, 0, 1),
                        "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
            opDeleteBodies(context, tid + "dsk", { "entities" : qCreatedBy(tid + "sk", EntityType.BODY) });
            return qCreatedBy(tid + "ex", EntityType.BODY);
        };
        const cut = function(bid, target, tool) { opBoolean(context, bid, { "tools" : tool, "targets" : target, "operationType" : BooleanOperationType.SUBTRACTION }); };
        const add = function(bid, target, tool) { opBoolean(context, bid, { "tools" : qUnion([target, tool]), "operationType" : BooleanOperationType.UNION }); };

        // ================= BASE
        const base = rectTool(id + "body", cx - L / 2, cx + L / 2, -head / 2, head / 2, 0, top, R);
        // strap channel under the floor, full length
        cut(id + "cutSlot", base, rectTool(id + "slot", -80, 50, -slotW / 2, slotW / 2, -1, slotH + 1, 0));
        // battery pocket, open up to the lid
        cut(id + "cutBatt", base, rectTool(id + "batt", -battW / 2, battW / 2, -battD / 2, battD / 2, floorTop, lidBot - floorTop + 0.01, battR));
        // tail bay: flare from the pocket width to the bay width, rounded far corners (R - wall)
        {
            var sk = newSketchOnPlane(context, id + "baySk", { "sketchPlane" : zPlane(floorTop) });
            const pts = [vector(flareX0, -battD / 2), vector(flareX1, -bayHalf), vector(bayXEnd, -bayHalf),
                         vector(bayXEnd, bayHalf), vector(flareX1, bayHalf), vector(flareX0, battD / 2), vector(flareX0, -battD / 2)];
            var mm = [];
            for (var p in pts) mm = append(mm, p * millimeter);
            skPolyline(sk, "p", { "points" : mm });
            skSolve(sk);
            opExtrude(context, id + "bayEx", { "entities" : qSketchRegion(id + "baySk", true), "direction" : vector(0, 0, 1),
                        "endBound" : BoundingType.BLIND, "endDepth" : (lidBot - floorTop + 0.01) * millimeter });
            const corners = qUnion([qContainsPoint(vertEdges(id + "bayEx"), vector(bayXEnd, bayHalf, floorTop + 1) * millimeter),
                                    qContainsPoint(vertEdges(id + "bayEx"), vector(bayXEnd, -bayHalf, floorTop + 1) * millimeter)]);
            opFillet(context, id + "bayF", { "entities" : corners, "radius" : (R - wall) * millimeter });
            opDeleteBodies(context, id + "bayDsk", { "entities" : qCreatedBy(id + "baySk", EntityType.BODY) });
            cut(id + "cutBay", base, qCreatedBy(id + "bayEx", EntityType.BODY));
        }
        // ring pocket from the seat up
        cut(id + "cutRing", base, cylTool(id + "ringP", ringPocket, seat, lidBot - seat + 0.01));
        // lid rebate
        cut(id + "cutReb", base, rectTool(id + "reb", cx - L / 2 + lip, cx + L / 2 - lip, -head / 2 + lip, head / 2 - lip, lidBot, lidT + 1, R - lip));
        // USB-C window and the shallow plug recess in the -X end wall
        cut(id + "cutUsb", base, rectTool(id + "usb", -tailLen - 1, bayXEnd + 0.01, -usbW / 2, usbW / 2, usbZ0, usbZ1 - usbZ0, 0));
        cut(id + "cutCb", base, rectTool(id + "cb", -tailLen - 1, -tailLen + cbD, -cbW / 2, cbW / 2, cbZ0, cbZ1 - cbZ0, 0));
        // divider posts either side of the XIAO's end (they overlap into the flared wall)
        const postY1 = battD / 2 + (bayHalf - battD / 2) * (flareX0 - divX0) / (flareX0 - flareX1) + 0.3;
        add(id + "addPost1", base, rectTool(id + "post1", divX0, divX1, divGap, postY1, floorTop - 0.01, seat - floorTop + 0.01, 0));
        add(id + "addPost2", base, rectTool(id + "post2", divX0, divX1, -postY1, -divGap, floorTop - 0.01, seat - floorTop + 0.01, 0));
        setProperty(context, { "entities" : base, "propertyType" : PropertyType.NAME, "value" : "BandIt v2 base" });

        // ================= LID (in place, sits in the rebate)
        const l = lip + clr;
        const lid = rectTool(id + "lid", cx - L / 2 + l, cx + L / 2 - l, -head / 2 + l, head / 2 - l, lidBot, lidT, R - l);
        cut(id + "cutHole", lid, cylTool(id + "hole", buttonHole, lidBot - 1, lidT + 2));
        // light window: thin the lid to (lidT - winDepth) in a ring over the LEDs
        const winTool = cylTool(id + "winO", winOd, lidBot - 1, winDepth + 1);
        cut(id + "winCut1", winTool, cylTool(id + "winI", winId, lidBot - 1.5, winDepth + 2));
        cut(id + "cutWin", lid, winTool);
        setProperty(context, { "entities" : lid, "propertyType" : PropertyType.NAME, "value" : "BandIt v2 lid" });
    });
