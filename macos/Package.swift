// swift-tools-version:5.9
import PackageDescription

// The native macOS shell of mdview: a Swift app (windows, menus, files) around the same page
// (viewer.js and friends) that the Tauri shell and the web app show. `./build.sh` makes MdView.app.
let package = Package(
    name: "MdView",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "MdView", path: "Sources/MdView"),
        // `swift test`: the shell driven in windows nobody sees, with the page of this checkout (Tests/MdViewTests/Harness.swift)
        .testTarget(name: "MdViewTests", dependencies: ["MdView"], path: "Tests/MdViewTests"),
    ]
)
