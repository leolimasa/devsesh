{
  description = "devsesh - Centralized dev session management and monitoring";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
devShells.default = pkgs.mkShell {
    buildInputs = with pkgs; [
      go
      sqlite
      nodejs_22
      chromium
      playwright
      xvfb
      tmux
      glib
      libglvnd
      nss
      nspr
      atk
      at-spi2-atk
      cups
      dbus
      expat
      libxkbcommon
      libdrm
      mesa
      gtk3
      pango
      cairo
      alsa-lib
      libpulseaudio
    ];

    shellHook = ''
      export CGO_ENABLED=0
      
      # Set library paths for chromium/playwright
      export LD_LIBRARY_PATH=${pkgs.glib}/lib:${pkgs.libglvnd}/lib:${pkgs.nss}/lib:${pkgs.nspr}/lib:${pkgs.atk}/lib:${pkgs.at-spi2-atk}/lib:${pkgs.cups}/lib:${pkgs.dbus}/lib:${pkgs.expat}/lib:${pkgs.libxkbcommon}/lib:${pkgs.libdrm}/lib:${pkgs.mesa}/lib:${pkgs.gtk3}/lib:${pkgs.pango}/lib:${pkgs.cairo}/lib:${pkgs.alsa-lib}/lib:${pkgs.libpulseaudio}/lib:$LD_LIBRARY_PATH
      
      # Tell Playwright to use system chromium
      export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
      export CHROMIUM_PATH=${pkgs.chromium}/bin/chromium
    '';
  };
      });
}