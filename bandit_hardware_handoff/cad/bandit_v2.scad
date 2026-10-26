// BandIt v2 "pill", OpenSCAD twin of bandit_v2.py (mm, Z up, X along the strap, LED ring at the origin).
// The STLs were generated and validated by the Python version; this mirrors its numbers for editing in a CAD tool.
part = "all";   // "base", "lid", "all"

head = 42; tail_len = 43; R = 10; wall = 1.5;
slot_w = 17.5; slot_h = 1.3; floor_t = 1.0;
batt_h = 5.5; ring_lift = 1.0; ring_h = 3.2; ring_gap = 0.4; lid_t = 1.2; lip = 0.8; clr = 0.2;
ring_pocket = 38.3; batt_pocket = [37, 32, 3];
bay_x_end = -41.5; flare_x = [-18.5, -24.0]; bay_half = 19.5;
divider = [-20.0, -18.5, 9.2];
usb_w = 10.6; usb_z = [3.3, 7.5]; usb_cb = [14.0, 0.7, 2.6, 8.2];
switch_h = 5.0; button_hole = 6.5;   // 6x6 tactile switch pressed directly through the lid

floor_top = slot_h + floor_t; batt_top = floor_top + batt_h; seat = batt_top + ring_lift;
ring_top = seat + ring_h; lid_bot = ring_top + ring_gap; top = lid_bot + lid_t;
switch_top = batt_top + switch_h;
L = tail_len + head/2; cx = (head/2 - tail_len)/2;
$fn = 180;

module rrect(w, d, r) { offset(r = r) square([w - 2*r, d - 2*r], center = true); }
module outline(inset = 0) { translate([cx, 0]) rrect(L - 2*inset, head - 2*inset, R - inset); }
module bay2d() {   // flare from the pocket width to the bay width, rounded far corners
    rb = R - wall;
    hull() {
        translate([flare_x[0] - 0.01, -batt_pocket[1]/2]) square([0.01, batt_pocket[1]]);
        translate([flare_x[1], -bay_half]) square([0.01, 2*bay_half]);
    }
    hull() {
        translate([flare_x[1] - 0.01, -bay_half]) square([0.01, 2*bay_half]);
        for (s = [-1, 1]) translate([bay_x_end + rb, s*(bay_half - rb)]) circle(r = rb);
    }
}
module lower2d() { rrect(batt_pocket[0], batt_pocket[1], batt_pocket[2]); bay2d(); }
module upper2d() { circle(d = ring_pocket); lower2d(); }

module base() {
    difference() {
        linear_extrude(top) outline();
        translate([-100, -slot_w/2, -1]) cube([200, slot_w, slot_h + 1]);                 // strap channel
        translate([0, 0, floor_top]) linear_extrude(seat - floor_top + 0.01) lower2d();
        translate([0, 0, seat]) linear_extrude(lid_bot - seat + 0.01) upper2d();
        translate([0, 0, lid_bot]) linear_extrude(lid_t + 1) outline(lip);               // rebate
        translate([-tail_len - 1, -usb_w/2, usb_z[0]]) cube([wall + 2, usb_w, usb_z[1] - usb_z[0]]);          // USB window
        translate([-tail_len - 1, -usb_cb[0]/2, usb_cb[2]]) cube([1 + usb_cb[1], usb_cb[0], usb_cb[3] - usb_cb[2]]); // plug recess
    }
    // divider posts either side of the XIAO (the gap between them is 2 * divider[2])
    for (s = [-1, 1]) translate([divider[0], s > 0 ? divider[2] : -(bay_half), floor_top - 0.01])
        cube([divider[1] - divider[0], bay_half - divider[2], seat - floor_top + 0.01]);
}
module lid() {
    difference() {
        translate([0, 0, lid_bot]) linear_extrude(lid_t) outline(lip + clr);
        translate([0, 0, lid_bot - 1]) cylinder(d = button_hole, h = lid_t + 2);
    }
}
if (part == "base") base();
if (part == "lid") lid();
if (part == "all") { base(); translate([0, 0, 12]) lid(); }
