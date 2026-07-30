package auth

import "golang.org/x/crypto/bcrypt"

func HashPassword(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	return string(b), err
}

func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// dummyHash is a bcrypt hash of an arbitrary fixed password, used only to
// burn the same CPU time as a real password check when the account being
// logged into doesn't exist. Without this, a lookup on a missing email
// returning immediately (skipping bcrypt entirely) made "does this email
// exist" distinguishable by response time alone, even though the response
// body is identical either way — see Service.Login.
var dummyHash = mustHashForTiming("not-a-real-password-used-only-to-equalize-login-timing")

func mustHashForTiming(plain string) string {
	h, err := HashPassword(plain)
	if err != nil {
		// bcrypt only errors on a >72 byte password or an invalid cost;
		// both are fixed constants here, so this can't happen in practice.
		panic(err)
	}
	return h
}
