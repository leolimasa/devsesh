// SPDX-License-Identifier: MIT
//
// Copyright (C) 2024 Daniel Bourdrez. All Rights Reserved.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree or at
// https://spdx.org/licenses/MIT.html

package hash

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"errors"
	"hash"
	"io"

	"golang.org/x/crypto/hkdf"
	"golang.org/x/crypto/sha3"
)

const (
	// block size in bytes.
	blockSHA3256 = 1088 / 8
	blockSHA3384 = 832 / 8
	blockSHA3512 = 576 / 8
)

var errHmacKeySize = errors.New("hmac key length is larger than hash output size")

func newFixed(hid Hash) newHash {
	var hashFunc func() hash.Hash

	switch hid {
	case SHA256:
		hashFunc = sha256.New
	case SHA384:
		hashFunc = sha512.New384
	case SHA512:
		hashFunc = sha512.New
	case SHA3_256:
		hashFunc = sha3.New256
	case SHA3_384:
		hashFunc = sha3.New384
	case SHA3_512:
		hashFunc = sha3.New512
	}

	return func() Hasher {
		return &Fixed{
			id:   hid,
			hash: hashFunc(),
			f:    hashFunc,
		}
	}
}

// Fixed offers easy an easy-to-use API for common cryptographic hash operations of the SHA family.
type Fixed struct {
	hash hash.Hash
	f    func() hash.Hash
	id   Hash
}

// Algorithm returns the Hash function identifier.
func (h *Fixed) Algorithm() Hash {
	return h.id
}

// Hash hashes the concatenation of input and returns size bytes. The size is ignored as the output size is standard.
func (h *Fixed) Hash(_ uint, input ...[]byte) []byte {
	h.Reset()

	for _, i := range input {
		_, _ = h.Write(i)
	}

	return h.Sum(nil)
}

// Read returns size bytes from the current hash.
// It does not change the underlying hash state.
func (h *Fixed) Read(_ int) []byte {
	return h.Sum(nil)
}

// Write implements io.Writer.
func (h *Fixed) Write(input []byte) (int, error) {
	return h.hash.Write(input)
}

// Sum appends the current hash to b and returns the resulting slice.
// It does not change the underlying hash state.
func (h *Fixed) Sum(prefix []byte) []byte {
	return h.hash.Sum(prefix)
}

// Reset resets the hash to its initial state.
func (h *Fixed) Reset() {
	h.hash.Reset()
}

// Size returns the number of bytes Hash will return.
func (h *Fixed) Size() int {
	return h.id.Size()
}

// BlockSize returns the hash's underlying block size.
func (h *Fixed) BlockSize() int {
	return h.id.BlockSize()
}

// GetHashFunction returns the underlying Fixed Hasher.
func (h *Fixed) GetHashFunction() *Fixed {
	return h
}

// GetXOF returns nil.
func (h *Fixed) GetXOF() *ExtendableHash {
	return nil
}

// Hmac wraps the built-in hmac.
func (h *Fixed) Hmac(message, key []byte) []byte {
	if len(key) > h.id.Size() {
		panic(errHmacKeySize)
	}

	hm := hmac.New(h.f, key)
	_, _ = hm.Write(message)

	return hm.Sum(nil)
}

// HKDF is an "extract-then-expand" HMAC based Key derivation function,
// where info is the specific usage identifying information.
func (h *Fixed) HKDF(secret, salt, info []byte, length int) []byte {
	if length == 0 {
		length = h.id.Size()
	}

	kdf := hkdf.New(h.f, secret, salt, info)
	dst := make([]byte, length)

	_, _ = io.ReadFull(kdf, dst)

	return dst
}

// HKDFExtract is an "extract" only HKDF, where the secret and salt are used to generate a pseudorandom key. This key
// can then be used in multiple HKDFExpand calls to derive individual different keys.
func (h *Fixed) HKDFExtract(secret, salt []byte) []byte {
	return hkdf.Extract(h.f, secret, salt)
}

// HKDFExpand is an "expand" only HKDF, where the key should be an already random/hashed input,
// and info specific key usage identifying information.
func (h *Fixed) HKDFExpand(pseudorandomKey, info []byte, length int) []byte {
	if length == 0 {
		length = h.id.Size()
	}

	kdf := hkdf.Expand(h.f, pseudorandomKey, info)
	dst := make([]byte, length)

	_, _ = kdf.Read(dst)

	return dst
}
