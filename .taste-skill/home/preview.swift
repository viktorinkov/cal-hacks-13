import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
let r = Double(args[3])!, g = Double(args[4])!, b = Double(args[5])!

let img = CIImage(contentsOf: input)!
let bg = CIImage(color: CIColor(red: r, green: g, blue: b)).cropped(to: img.extent)
let comp = img.composited(over: bg)
let ctx = CIContext()
let cg = ctx.createCGImage(comp, from: comp.extent)!
let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, cg, nil)
CGImageDestinationFinalize(dest)
