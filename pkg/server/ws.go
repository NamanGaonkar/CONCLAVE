package server

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// WSConn represents a connected RFC6455 WebSocket client.
type WSConn struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
	closed bool
}

// Upgrade upgrades an HTTP connection to a WebSocket connection.
func Upgrade(w http.ResponseWriter, r *http.Request) (*WSConn, error) {
	if r.Header.Get("Upgrade") != "websocket" && r.Header.Get("upgrade") != "websocket" {
		return nil, fmt.Errorf("missing Upgrade: websocket header")
	}

	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, fmt.Errorf("missing Sec-WebSocket-Key")
	}

	h := sha1.New()
	h.Write([]byte(key + wsGUID))
	accept := base64.StdEncoding.EncodeToString(h.Sum(nil))

	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, fmt.Errorf("server does not support hijacking")
	}

	conn, bufrw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}

	response := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"

	if _, err := conn.Write([]byte(response)); err != nil {
		_ = conn.Close()
		return nil, err
	}

	return &WSConn{
		conn:   conn,
		reader: bufrw.Reader,
	}, nil
}

// WriteText sends a text frame to the WebSocket client.
func (c *WSConn) WriteText(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return fmt.Errorf("connection closed")
	}

	payload := []byte(text)
	length := len(payload)

	var header []byte
	header = append(header, 0x81) // FIN + text frame opcode

	if length <= 125 {
		header = append(header, byte(length))
	} else if length <= 65535 {
		header = append(header, 126)
		b := make([]byte, 2)
		binary.BigEndian.PutUint16(b, uint16(length))
		header = append(header, b...)
	} else {
		header = append(header, 127)
		b := make([]byte, 8)
		binary.BigEndian.PutUint64(b, uint64(length))
		header = append(header, b...)
	}

	if _, err := c.conn.Write(header); err != nil {
		c.closed = true
		return err
	}
	if _, err := c.conn.Write(payload); err != nil {
		c.closed = true
		return err
	}
	return nil
}

// ReadMessage reads the next text message from the WebSocket client.
func (c *WSConn) ReadMessage() (string, error) {
	for {
		b0, err := c.reader.ReadByte()
		if err != nil {
			return "", err
		}

		b1, err := c.reader.ReadByte()
		if err != nil {
			return "", err
		}

		opcode := b0 & 0x0F
		masked := (b1 & 0x80) != 0
		var length uint64 = uint64(b1 & 0x7F)

		if length == 126 {
			b := make([]byte, 2)
			if _, err := io.ReadFull(c.reader, b); err != nil {
				return "", err
			}
			length = uint64(binary.BigEndian.Uint16(b))
		} else if length == 127 {
			b := make([]byte, 8)
			if _, err := io.ReadFull(c.reader, b); err != nil {
				return "", err
			}
			length = binary.BigEndian.Uint64(b)
		}

		var mask [4]byte
		if masked {
			if _, err := io.ReadFull(c.reader, mask[:]); err != nil {
				return "", err
			}
		}

		payload := make([]byte, length)
		if _, err := io.ReadFull(c.reader, payload); err != nil {
			return "", err
		}

		if masked {
			for i := uint64(0); i < length; i++ {
				payload[i] ^= mask[i%4]
			}
		}

		// Close opcode
		if opcode == 0x08 {
			c.Close()
			return "", io.EOF
		}

		// Ping opcode -> respond with pong
		if opcode == 0x09 {
			c.mu.Lock()
			pong := []byte{0x8A, 0x00}
			_, _ = c.conn.Write(pong)
			c.mu.Unlock()
			continue
		}

		// Text frame
		if opcode == 0x01 {
			return string(payload), nil
		}
	}
}

// Close closes the WebSocket connection.
func (c *WSConn) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		_ = c.conn.Close()
	}
}
