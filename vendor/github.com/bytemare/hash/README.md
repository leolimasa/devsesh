# Cryptographic Hash Functions
[![hash](https://github.com/bytemare/hash/actions/workflows/ci.yml/badge.svg)](https://github.com/bytemare/hash/actions/workflows/ci.yml)
[![Go Reference](https://pkg.go.dev/badge/github.com/bytemare/hash.svg)](https://pkg.go.dev/github.com/bytemare/hash)
[![codecov](https://codecov.io/gh/bytemare/hash/branch/main/graph/badge.svg?token=5bQfB0OctA)](https://codecov.io/gh/bytemare/hash)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/8781/badge)](https://www.bestpractices.dev/projects/8781)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/bytemare/hash/badge)](https://securityscorecards.dev/viewer/?uri=github.com/bytemare/hash)


```
  import "github.com/bytemare/hash"
```

This package exposes a simple API to seamlessly use a variety of cryptographic functions. It aims at minimum code
adaptation in your code, and easy parameterization. It completely relies on built-ins.

It attempts to offer a single API for fixed and extensible-output functions,
Merkle–Damgård construction (e.g. SHA-1, SHA-2), sponge functions (e.g. SHA-3, SHAKE), and HAIFA structures (e.g. Blake2).
This API also provides useful metadata like block size, security, and output size when relevant.


## Documentation [![Go Reference](https://pkg.go.dev/badge/github.com/bytemare/hash.svg)](https://pkg.go.dev/github.com/bytemare/hash)

You can find the documentation and usage examples in [the package doc](https://pkg.go.dev/github.com/bytemare/hash) and [the project wiki](https://github.com/bytemare/hash/wiki) .

## Versioning

[SemVer](http://semver.org) is used for versioning. For the versions available, see the [tags on the repository](https://github.com/bytemare/hash/tags).


## Contributing

Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) for details on the code of conduct, and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
