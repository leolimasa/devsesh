// SPDX-License-Identifier: MIT
//
// Copyright (C) 2024 Daniel Bourdrez. All Rights Reserved.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree or at
// https://spdx.org/licenses/MIT.html

// Package hash is a small wrapper around built-in cryptographic hash functions to make their usage easier.
package hash

import (
	"crypto"
	"crypto/sha256"
	"crypto/sha512"
	"io"
)

type Hash uint8

const (
	// SHA256 identifies the Sha2 hashing function with 256 bit output.
	SHA256 = Hash(crypto.SHA256)

	// SHA384 identifies the Sha2 hashing function with 384 bit output.
	SHA384 = Hash(crypto.SHA384)

	// SHA512 identifies the Sha2 hashing function with 512 bit output.
	SHA512 = Hash(crypto.SHA512)

	// SHA3_256 identifies the Sha3 hashing function with 256 bit output.
	SHA3_256 = Hash(crypto.SHA3_256)

	// SHA3_384 identifies the Sha3 hashing function with 384 bit output.
	SHA3_384 = Hash(crypto.SHA3_384)

	// SHA3_512 identifies the Sha3 hashing function with 512 bit output.
	SHA3_512 = Hash(crypto.SHA3_512)

	maxFixed = 20

	// SHAKE128 identifies the SHAKE128 Extendable-Output Function.
	SHAKE128 Hash = maxFixed + 1

	// SHAKE256 identifies the SHAKE256 Extendable-Output Function.
	SHAKE256 Hash = maxFixed + 2

	// BLAKE2XB identifies the BLAKE2XB Extendable-Output Function.
	BLAKE2XB Hash = maxFixed + 3

	// BLAKE2XS identifies the BLAKE2XS Extendable-Output Function.
	BLAKE2XS Hash = maxFixed + 4

	maxID Hash = maxFixed + 5
)

// FromCrypto returns a Hashing identifier given a hash function defined in the built-in crypto,
// if it has been registered.
func FromCrypto(h crypto.Hash) Hash {
	i := Hash(h)
	if i.Available() {
		return i
	}

	return 0
}

// Available reports whether the given hash function is linked into the binary.
func (h Hash) Available() bool {
	return h < maxID && registeredHashes[h]
}

// Hash returns the hash of the concatenated input.
func (h Hash) Hash(input ...[]byte) []byte {
	return h.New().Hash(uint(h.Size()), input...)
}

// New returns the underlying Hasher function.
func (h Hash) New() Hasher {
	return hashes[h]()
}

// String returns the Hash functions name.
func (h Hash) String() string {
	return names[h]
}

// BlockSize returns the hash's underlying block size in bytes.
func (h Hash) BlockSize() int {
	return blockSizes[h]
}

// Size returns the standard number of bytes returned by Hash.
func (h Hash) Size() int {
	return outputSizes[h]
}

// SecurityLevel returns the hash function's security level in bits.
func (h Hash) SecurityLevel() int {
	return securityLevels[h]
}

// Type returns the hash function's type.
func (h Hash) Type() Type {
	switch {
	case SHA256 <= h && h < maxFixed && h.Available():
		return FixedOutputLength
	case maxFixed < h && h < maxID && h.Available():
		return ExtendableOutputFunction
	}

	return ""
}

// GetHashFunction returns the underlying Fixed Hasher for FixedOutputLength functions, and nil otherwise.
func (h Hash) GetHashFunction() *Fixed {
	return h.New().GetHashFunction()
}

// GetXOF returns the underlying ExtendableHash Hasher for ExtendableOutputFunction functions, and nil otherwise.
func (h Hash) GetXOF() *ExtendableHash {
	return h.New().GetXOF()
}

type Hasher interface {
	// Algorithm returns the Hash function identifier.
	Algorithm() Hash

	// Hash hashes the concatenation of input and returns size bytes. The size is ignored for fixed output length hashes
	// as their output size is standard.
	Hash(size uint, input ...[]byte) []byte

	// Read returns size bytes from the current hash.
	// The underlying hash state is not modified for Merkle–Damgård constructions, and size bytes will be consumed
	// for extendable output functions.
	Read(size int) []byte

	// Writer (via the embedded io.Writer interface) adds more data to the running hash.
	// It never returns an error.
	io.Writer

	// Sum appends the current hash to b and returns the resulting slice.
	Sum(prefix []byte) []byte

	// Reset resets the hash to its initial state.
	Reset()

	// Size returns the number of bytes Hash will return.
	Size() int

	// BlockSize returns the hash's underlying block size.
	BlockSize() int

	// GetHashFunction returns the underlying Fixed Hasher for FixedOutputLength functions, and nil otherwise.
	GetHashFunction() *Fixed

	// GetXOF returns the underlying ExtendableHash Hasher for ExtendableOutputFunction functions, and nil otherwise.
	GetXOF() *ExtendableHash
}

// Type identifies the hash function types.
type Type string

var (
	// FixedOutputLength identifies fixed output length hash functions.
	FixedOutputLength Type = "fixed"

	// ExtendableOutputFunction identifies extendable output length functions.
	ExtendableOutputFunction Type = "extendable-output-function"

	// output size in bytes.
	size256 = 32

	// security level in bits.
	sec128 = 128
	sec192 = 192
	sec224 = 224
	sec256 = 256
)

type newHash func() Hasher

var (
	registeredHashes = [maxID]bool{}
	hashes           = [maxID]newHash{}
	names            = [maxID]string{}
	blockSizes       = [maxID]int{}
	outputSizes      = [maxID]int{}
	securityLevels   = [maxID]int{}
)

func (h Hash) register(n func(Hash) newHash, name string, block, output, security int) {
	registeredHashes[h] = true
	hashes[h] = n(h)
	names[h] = name
	blockSizes[h] = block
	outputSizes[h] = output
	securityLevels[h] = security
}

func init() {
	SHA256.register(newFixed, crypto.SHA256.String(), sha256.BlockSize, crypto.SHA256.Size(), sec128)
	SHA384.register(newFixed, crypto.SHA384.String(), sha512.BlockSize, crypto.SHA384.Size(), sec192)
	SHA512.register(newFixed, crypto.SHA512.String(), sha512.BlockSize, crypto.SHA512.Size(), sec256)
	SHA3_256.register(newFixed, crypto.SHA3_256.String(), blockSHA3256, crypto.SHA3_256.Size(), sec128)
	SHA3_384.register(newFixed, crypto.SHA3_384.String(), blockSHA3384, crypto.SHA3_384.Size(), sec192)
	SHA3_512.register(newFixed, crypto.SHA3_512.String(), blockSHA3512, crypto.SHA3_512.Size(), sec256)
	SHAKE128.register(newXOF, shake128, blockSHAKE128, size256, sec128)
	SHAKE256.register(newXOF, shake256, blockSHAKE256, size256, sec224)
	BLAKE2XB.register(newXOF, blake2xb, 0, size256, sec128)
	BLAKE2XS.register(newXOF, blake2xs, 0, size256, sec128)
}
