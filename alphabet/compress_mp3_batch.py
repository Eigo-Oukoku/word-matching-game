#!/usr/bin/env python3
import subprocess
import sys
import os
import glob

def compress_audio_to_mp3_48k(input_file, output_dir):
    """
    音声ファイルを48kHzのMP3に圧縮
    
    Args:
        input_file (str): 入力ファイルパス
        output_dir (str): 出力フォルダパス
    """
    
    # 出力フォルダが存在しない場合は作成
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"出力フォルダを作成しました: {output_dir}")
    
    # 入力ファイルのベース名を取得（拡張子を除く）
    base_name = os.path.splitext(os.path.basename(input_file))[0]
    output_file = os.path.join(output_dir, f"{base_name}.mp3")
    
    # FFmpeg コマンド - 48kHzでMP3に変換
    cmd = [
        'ffmpeg',
        '-i', input_file,           # 入力ファイル
        '-ar', '48000',             # サンプリング周波数 48kHz
        '-ab', '128k',              # ビットレート 128kbps
        '-ac', '2',                 # ステレオ
        '-f', 'mp3',                # 出力形式をMP3に指定
        output_file                 # 出力ファイル
    ]
    
    try:
        print(f"圧縮中: {os.path.basename(input_file)} -> {os.path.basename(output_file)}")
        
        # FFmpeg を実行
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        
        print(f"✅ 圧縮完了: {os.path.basename(input_file)}")
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"❌ エラーが発生しました ({os.path.basename(input_file)}): {e}")
        print(f"エラーメッセージ: {e.stderr}")
        return False
    except FileNotFoundError:
        print("ffmpeg が見つかりません。FFmpeg をインストールしてください。")
        return False

def compress_multiple_mp3_48k(input_pattern, output_dir):
    """
    複数の音声ファイルを48kHzのMP3に一括変換
    
    Args:
        input_pattern (str): 入力ファイルのパターン
        output_dir (str): 出力フォルダパス
    """
    
    # 指定されたパターンに一致するファイルを検索
    input_files = glob.glob(input_pattern)
    
    if not input_files:
        print(f"ファイルが見つかりません: {input_pattern}")
        return False
    
    print(f"総ファイル数: {len(input_files)}")
    print("=" * 50)
    
    success_count = 0
    error_count = 0
    
    for input_file in input_files:
        # 音声ファイルのみ処理
        if input_file.lower().endswith(('.wav', '.mp3', '.m4a', '.flac', '.aac', '.ogg')):
            if compress_audio_to_mp3_48k(input_file, output_dir):
                success_count += 1
            else:
                error_count += 1
        else:
            print(f"スキップ: {os.path.basename(input_file)} (対応していない形式)")
    
    print("=" * 50)
    print(f"処理完了: {success_count} 件成功, {error_count} 件失敗")
    
    return error_count == 0

if __name__ == "__main__":
    # 指定されたパス
    output_directory = "/Users/takamorimusashi/Documents/Claude/Projects/Eigo-ninja-Patch1/audio"
    
    if len(sys.argv) < 2:
        print("使用方法: python compress_mp3_batch.py <入力ファイルパターン>")
        print("例1: python compress_mp3_batch.py \"*.wav\"")
        print("例2: python compress_mp3_batch.py \"/Users/takamorimusashi/Documents/*.mp3\"")
        print("例3: python compress_mp3_batch.py \"*.flac\"")
        print(f"出力フォルダ: {output_directory}")
        sys.exit(1)
    
    input_pattern = sys.argv[1]
    
    # 出力フォルダの確認
    if not os.path.exists(output_directory):
        os.makedirs(output_directory)
        print(f"出力フォルダを作成しました: {output_directory}")
    
    print(f"入力パターン: {input_pattern}")
    print(f"出力フォルダ: {output_directory}")
    print(f"出力形式: MP3 (48kHz)")
    print("-" * 50)
    
    # 一括処理実行
    success = compress_multiple_mp3_48k(input_pattern, output_directory)
    
    if success:
        print("✅ すべてのファイルの圧縮が完了しました！")
    else:
        print("⚠️ 一部のファイルの圧縮に失敗しました。")
        sys.exit(1)