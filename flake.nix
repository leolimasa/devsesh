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

        # Build the web frontend (React/Vite) into dist/
        webDist = pkgs.buildNpmPackage {
          pname = "devsesh-web";
          version = "0.1.0";
          src = ./web;
          npmDepsHash = "sha256-Z8bq8WyPM7OQZIjMguNjQ0O/eOpD38MISj//Uf5Aevo=";
          npmBuild = "npm run build";
          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };

        # Build the devsesh Go binary with embedded web frontend and WASM client.
        # preBuild compiles the WASM SSH client and copies the web dist into place
        # so the Go embed directive (web/embed.go) can find the files.
        devseshPackage = (pkgs.buildGoModule {
          pname = "devsesh";
          version = "0.1.0";
          src = ./.;

          vendorHash = null;

          nativeBuildInputs = [ pkgs.go ];

          preBuild = ''
            # Build WASM SSH client for browser terminal.
            # -trimpath removes filesystem paths from the binary.
            # -ldflags="-s -w" strips debug info and symbol table.
            echo "Building WASM SSH client..."
            GOOS=js GOARCH=wasm go build \
              -trimpath \
              -ldflags="-s -w" \
              -o web/public/sshclient.wasm \
              ./web/wasm/sshclient/

            # Copy pre-built web frontend dist into the source tree
            # so Go's embed directive (web/embed.go: //go:embed dist) finds it
            echo "Copying web dist..."
            mkdir -p web/dist
            cp -r ${webDist}/* web/dist/
          '';

          # Build only the main binary (not the WASM client)
          subPackages = [ "." ];

          # Disable CGO for static linking
          hardeningDisable = [ "fortify" ];

          meta = {
            description = "Centralized dev session management and monitoring";
            mainProgram = "devsesh";
          };
        }).overrideAttrs (_: {
          # Allow Go compiler references in the output since the embedded WASM
          # binary (built in preBuild) contains Go runtime strings.
          disallowedReferences = [];
        });
      in
      {
        packages = {
          default = devseshPackage;
          devsesh = devseshPackage;
          devsesh-web = webDist;
        };

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
            export IS_DEVSESH_NIX=1
            export ENV_NAME="$ENV_NAME devsesh"
          '';
        };
      });
}
